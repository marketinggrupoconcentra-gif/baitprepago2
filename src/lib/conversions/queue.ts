/**
 * src/lib/conversions/queue.ts — Cola de conversiones (app.conversion_deliveries)
 *
 * enqueue*: escribe filas 'pending' (idempotente por lead+proveedor+evento).
 * processConversionQueue: la ejecuta el cron /api/cron/conversions.
 */
import 'server-only';
import { and, eq, lte, sql, inArray } from 'drizzle-orm';
import { getDb, schema, type TransactionClient } from '@/db/index';
import { decryptPII } from '@/lib/crypto';
import { getGoogleAdsConfig, getMetaCapiConfig, getWonConversionValue } from '@/lib/integrations/config';
import { uploadClickConversion } from '@/lib/integrations/google-ads';
import { sendMetaEvent } from '@/lib/integrations/meta-capi';
import { logError, logInfo } from '@/lib/log';

type DbLike = ReturnType<typeof getDb> | TransactionClient;

const PROVIDERS = ['google_ads', 'meta_capi'] as const;
const MAX_ATTEMPTS = 6;
const BATCH = 40;

/** Encola el evento `lead` para ambos proveedores dentro de la transacción del alta. */
export async function enqueueLeadConversions(db: DbLike, opts: { leadId: string; eventId: string; occurredAt: Date }) {
  await db.insert(schema.conversionDeliveries)
    .values(PROVIDERS.map((provider) => ({
      leadId: opts.leadId, provider, event: 'lead' as const, eventId: opts.eventId, occurredAt: opts.occurredAt,
    })))
    .onConflictDoNothing();
}

/** Encola el evento `won` (portabilidad ganada) — lo dispara el cambio de estado comercial. */
export async function enqueueWonConversions(db: DbLike, opts: { leadId: string; occurredAt: Date }) {
  await db.insert(schema.conversionDeliveries)
    .values(PROVIDERS.map((provider) => ({
      leadId: opts.leadId, provider, event: 'won' as const, eventId: `${opts.leadId}:won`, occurredAt: opts.occurredAt,
    })))
    .onConflictDoNothing();
}

function backoff(attempts: number): Date {
  // 5, 20, 45, 80, 125 min…
  return new Date(Date.now() + attempts * attempts * 5 * 60_000);
}

const safeDecrypt = (v: string | null | undefined) => {
  if (!v) return undefined;
  try { return decryptPII(v); } catch { return undefined; }
};

export interface QueueRunSummary {
  claimed: number; sent: number; failed: number; dead: number; skipped: number;
}

export async function processConversionQueue(): Promise<QueueRunSummary> {
  const db = getDb();
  const summary: QueueRunSummary = { claimed: 0, sent: 0, failed: 0, dead: 0, skipped: 0 };
  const now = new Date();

  const rows = await db.select().from(schema.conversionDeliveries)
    .where(and(eq(schema.conversionDeliveries.status, 'pending'), lte(schema.conversionDeliveries.nextAttemptAt, now)))
    .orderBy(schema.conversionDeliveries.nextAttemptAt)
    .limit(BATCH);
  summary.claimed = rows.length;
  if (rows.length === 0) return summary;

  const [google, meta, wonValue] = await Promise.all([getGoogleAdsConfig(), getMetaCapiConfig(), getWonConversionValue()]);

  // Sin configuración → se marcan 'skipped' (no se reintentan cuando se configure más tarde:
  // Meta acepta 7 días y Google 90; conviene empezar limpio).
  const skip = async (ids: string[], reason: string) => {
    if (ids.length === 0) return;
    await db.update(schema.conversionDeliveries)
      .set({ status: 'skipped', lastError: reason, updatedAt: new Date() })
      .where(inArray(schema.conversionDeliveries.id, ids));
    summary.skipped += ids.length;
  };
  await skip(rows.filter((r) => r.provider === 'google_ads' && (!google || !(r.event === 'lead' ? google.leadConversionActionId : google.wonConversionActionId))).map((r) => r.id), 'not_configured');
  await skip(rows.filter((r) => r.provider === 'meta_capi' && !meta).map((r) => r.id), 'not_configured');

  const pending = rows.filter((r) =>
    (r.provider === 'google_ads' && google && (r.event === 'lead' ? google.leadConversionActionId : google.wonConversionActionId)) ||
    (r.provider === 'meta_capi' && meta));

  for (const row of pending) {
    const [lead] = await db.select({
      emailEnc: schema.leads.emailEnc, phoneEnc: schema.leads.phoneEnc,
      firstNameEnc: schema.leads.firstNameEnc, lastNameEnc: schema.leads.lastNameEnc,
      createdAt: schema.leads.createdAt,
      gclidEnc: schema.leadAttribution.gclidEnc, gbraidEnc: schema.leadAttribution.gbraidEnc,
      wbraidEnc: schema.leadAttribution.wbraidEnc, fbclidEnc: schema.leadAttribution.fbclidEnc,
      fbpEnc: schema.leadAttribution.fbpEnc, userAgent: schema.leadAttribution.userAgent,
      landingUrl: schema.leadAttribution.landingUrl, firstTouchAt: schema.leadAttribution.firstTouchAt,
    }).from(schema.leads)
      .leftJoin(schema.leadAttribution, eq(schema.leadAttribution.leadId, schema.leads.id))
      .where(eq(schema.leads.id, row.leadId)).limit(1);

    if (!lead) { await skip([row.id], 'lead_missing'); continue; }

    const email = safeDecrypt(lead.emailEnc);
    const phone = safeDecrypt(lead.phoneEnc);
    const value = row.event === 'won' ? wonValue : undefined;

    let result: { ok: boolean; error?: string; retryable?: boolean };
    try {
      if (row.provider === 'google_ads' && google) {
        const gclid = safeDecrypt(lead.gclidEnc), gbraid = safeDecrypt(lead.gbraidEnc), wbraid = safeDecrypt(lead.wbraidEnc);
        result = await uploadClickConversion(google, {
          conversionActionId: (row.event === 'lead' ? google.leadConversionActionId : google.wonConversionActionId)!,
          occurredAt: row.occurredAt, orderId: row.eventId, value, gclid, gbraid, wbraid, email, phone,
        });
      } else if (row.provider === 'meta_capi' && meta) {
        result = await sendMetaEvent(meta, {
          eventName: row.event === 'lead' ? 'Lead' : 'Purchase',
          eventId: row.eventId, occurredAt: row.occurredAt,
          sourceUrl: lead.landingUrl ?? undefined,
          email, phone, firstName: safeDecrypt(lead.firstNameEnc), lastName: safeDecrypt(lead.lastNameEnc),
          fbclid: safeDecrypt(lead.fbclidEnc), fbp: safeDecrypt(lead.fbpEnc),
          userAgent: lead.userAgent ?? undefined, value,
        });
      } else {
        continue;
      }
    } catch (err) {
      // Red / credenciales: reintentable
      result = { ok: false, error: (err instanceof Error ? err.message : String(err)).slice(0, 200), retryable: true };
    }

    const attempts = row.attempts + 1;
    if (result.ok) {
      await db.update(schema.conversionDeliveries)
        .set({ status: 'sent', attempts, sentAt: new Date(), lastError: null, updatedAt: new Date() })
        .where(eq(schema.conversionDeliveries.id, row.id));
      summary.sent++;
      continue;
    }

    const dead = !result.retryable || attempts >= MAX_ATTEMPTS;
    await db.update(schema.conversionDeliveries)
      .set({
        status: dead ? 'dead' : 'pending',
        attempts,
        nextAttemptAt: dead ? row.nextAttemptAt : backoff(attempts),
        lastError: result.error ?? 'unknown',
        updatedAt: new Date(),
      })
      .where(eq(schema.conversionDeliveries.id, row.id));
    if (dead) summary.dead++; else summary.failed++;
    logError('conversions', `${row.provider}:${row.event}`, new Error(result.error ?? 'unknown'));
  }

  logInfo('conversions', 'run', { ...summary });
  return summary;
}

/** Conteos por proveedor/estado para la pestaña de integraciones. */
export async function conversionQueueStats() {
  const db = getDb();
  const rows = await db.select({
    provider: schema.conversionDeliveries.provider,
    status: schema.conversionDeliveries.status,
    n: sql<number>`count(*)::int`,
  }).from(schema.conversionDeliveries)
    .groupBy(schema.conversionDeliveries.provider, schema.conversionDeliveries.status);
  return rows;
}
