import 'server-only';
import { enqueueLeadConversions } from '@/lib/conversions/queue';
import { schema } from '@/db';
import { eq, sql } from 'drizzle-orm';

/** Rollback intencional cuando otra request concurrente ya ganó la idempotency key. */
export class IdempotencyRaceError extends Error {}
/** Rollback intencional cuando el teléfono ya pertenece a un lead existente. */
export class DuplicatePhoneError extends Error {}

import type { TransactionClient } from '@/db';

export async function submitLead(
  tx: TransactionClient,
  opts: {
    now: Date;
    leadId: string;
    idempotencyKey: string;
    route: string;
    requestHash: string;
    publicReference: string;
    idemExpiresAt: Date;
    normalizedPhone: string;
    firstNameEnc: string;
    lastNameEnc: string;
    emailEnc: string;
    phoneEnc: string;
    birthdateEnc?: string | null;
    emailBidx: string;
    phoneBidx: string;
    stateCode?: string | null;
    planCode: string;
    /** Secreto tipo NIP: si se omite NO se escribe lead_secrets (BAIT Prepago nunca persiste el NIP). */
    nipEnc?: string;
    nipExpiresAt?: Date;
    sessionId?: string;
    sourceCategory: 'google_ads' | 'meta_ads' | 'paid_other' | 'organic' | 'referral' | 'direct' | 'other';
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    utmTerm?: string;
    utmContent?: string;
    lastUtmSource?: string;
    lastUtmMedium?: string;
    lastUtmCampaign?: string;
    lastUtmTerm?: string;
    lastUtmContent?: string;
    gclidHash?: string;
    fbclidHash?: string;
    /** Click ids reales cifrados (solo para importar conversiones offline). */
    gclidEnc?: string;
    gbraidEnc?: string;
    wbraidEnc?: string;
    fbclidEnc?: string;
    fbpEnc?: string;
    userAgent?: string;
    fbAdId?: string;
    fbAdsetId?: string;
    fbCampaignId?: string;
    firstTouchAt?: Date;
    lastTouchAt?: Date;
    landingUrl?: string;
    referrerHost?: string;
    contractingAccepted: boolean;
    privacyAccepted: boolean;
    privacyPolicyVersion: string;
    termsVersion: string;
    deviceCategory?: 'mobile' | 'tablet' | 'desktop';
  }
) {
  // 1. Reservar la idempotency key ANTES de nada. Si otra request concurrente
  //    ya la tiene, el UNIQUE bloquea/rechaza y hacemos rollback (FLW-001 race).
  const idemRows = await tx
    .insert(schema.idempotencyKeys)
    .values({
      idempotencyKey: opts.idempotencyKey,
      endpoint: opts.route,
      requestHash: opts.requestHash,
      responseReference: opts.publicReference,
      expiresAt: opts.idemExpiresAt,
    })
    .onConflictDoNothing()
    .returning({ id: schema.idempotencyKeys.id });
  if (idemRows.length === 0) throw new IdempotencyRaceError();

  // 2. Serializar por teléfono dentro de Postgres y comprobar toda la historia.
  //    El lock transaccional evita que dos requests con distintas idempotency keys
  //    consulten "vacío" a la vez y creen dos leads para el mismo número.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${opts.phoneBidx}, 0))`);
  const existingPhone = await tx
    .select({ id: schema.leads.id })
    .from(schema.leads)
    .where(eq(schema.leads.phoneBidx, opts.phoneBidx))
    .limit(1);
  if (existingPhone.length > 0) throw new DuplicatePhoneError();


  // 4. Lead + relacionados.
  await tx.insert(schema.leads).values({
    id: opts.leadId,
    publicReference: opts.publicReference,
    status: 'received',
    firstNameEnc: opts.firstNameEnc,
    lastNameEnc: opts.lastNameEnc,
    emailEnc: opts.emailEnc,
    phoneEnc: opts.phoneEnc,
    birthdateEnc: opts.birthdateEnc ?? null,
    emailBidx: opts.emailBidx,
    phoneBidx: opts.phoneBidx,
    stateCode: opts.stateCode ?? null,
    planCode: opts.planCode,
  });

  if (opts.nipEnc && opts.nipExpiresAt) {
    await tx.insert(schema.leadSecrets).values({
      leadId: opts.leadId,
      nipEnc: opts.nipEnc,
      expiresAt: opts.nipExpiresAt,
    });
  }

  await tx.insert(schema.leadAttribution).values({
    leadId: opts.leadId,
    sessionId: opts.sessionId,
    sourceCategory: opts.sourceCategory,
    firstUtmSource: opts.utmSource,
    firstUtmMedium: opts.utmMedium,
    firstUtmCampaign: opts.utmCampaign,
    firstUtmTerm: opts.utmTerm,
    firstUtmContent: opts.utmContent,
    lastUtmSource: opts.lastUtmSource ?? opts.utmSource,
    lastUtmMedium: opts.lastUtmMedium ?? opts.utmMedium,
    lastUtmCampaign: opts.lastUtmCampaign ?? opts.utmCampaign,
    lastUtmTerm: opts.lastUtmTerm ?? opts.utmTerm,
    lastUtmContent: opts.lastUtmContent ?? opts.utmContent,
    gclidHash: opts.gclidHash,
    fbclidHash: opts.fbclidHash,
    gclidEnc: opts.gclidEnc,
    gbraidEnc: opts.gbraidEnc,
    wbraidEnc: opts.wbraidEnc,
    fbclidEnc: opts.fbclidEnc,
    fbpEnc: opts.fbpEnc,
    userAgent: opts.userAgent,
    fbAdId: opts.fbAdId,
    fbAdsetId: opts.fbAdsetId,
    fbCampaignId: opts.fbCampaignId,
    landingUrl: opts.landingUrl || undefined,
    referrerHost: opts.referrerHost,
    firstTouchAt: opts.firstTouchAt ?? opts.now,
    lastTouchAt: opts.lastTouchAt ?? opts.now,
  });

  await tx.insert(schema.leadConsents).values({
    leadId: opts.leadId,
    contractingAccepted: opts.contractingAccepted,
    privacyAccepted: opts.privacyAccepted,
    privacyPolicyVersion: opts.privacyPolicyVersion,
    termsVersion: opts.termsVersion,
    acceptedAt: opts.now,
  } as typeof schema.leadConsents.$inferInsert);

  // 4b. Cola de conversiones (Google Ads offline / Meta CAPI). event_id = idempotency key,
  //     el mismo uuid que el Pixel usa como eventID → deduplicación en Meta.
  await enqueueLeadConversions(tx, { leadId: opts.leadId, eventId: opts.idempotencyKey, occurredAt: opts.now });

  // 5. lead_success SOLO si el lead quedó persistido (misma tx → consistente).
  await tx.insert(schema.analyticsEvents).values({
    sessionId: opts.sessionId,
    eventName: 'lead_success',
    pagePath: '/',
    sourceCategory: opts.sourceCategory,
    utmSource: opts.utmSource,
    utmMedium: opts.utmMedium,
    utmCampaign: opts.utmCampaign,
    utmContent: opts.utmContent,
    utmTerm: opts.utmTerm,
    deviceCategory: opts.deviceCategory,
  });
}
