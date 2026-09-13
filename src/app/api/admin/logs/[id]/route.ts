/**
 * GET /api/admin/logs/[id] — Detalle de un registro del delivery_outbox
 *
 * Requiere: logs.view  (PII descifrada además: leads.detail.view → auditado)
 * `id` = app.delivery_outbox.id
 *
 * La "bitácora de intentos" se RECONSTRUYE a partir de la fila del outbox
 * (created_at, updated_at, attempts, next_attempt_at, status). No existe una
 * tabla de intentos individuales — `last_error_code` guarda sólo el último.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb, schema } from '@/db/index';
import { requireAdminSession } from '@/lib/session';
import { decryptPII } from '@/lib/crypto';
import { eq } from 'drizzle-orm';
import { logError } from '@/lib/log';
import { hasPermission } from '@/lib/rbac';
import { writeAuditLog } from '@/lib/audit';
import { MAX_ATTEMPTS, RETRY_INTERVAL_SECONDS } from '@/lib/outbox/claim';
import { classifyOutboxError } from '@/lib/outbox/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  let session;
  try {
    session = await requireAdminSession('logs.view');
  } catch (res) {
    return res as NextResponse;
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 400 });
  }

  const canViewPii = hasPermission(session.role, 'leads.detail.view');
  const canRetry = hasPermission(session.role, 'logs.retry');

  try {
    const db = getDb();

    const [row] = await db
      .select({
        id: schema.deliveryOutbox.id,
        leadId: schema.deliveryOutbox.leadId,
        destination: schema.deliveryOutbox.destination,
        status: schema.deliveryOutbox.status,
        attempts: schema.deliveryOutbox.attempts,
        nextAttemptAt: schema.deliveryOutbox.nextAttemptAt,
        deliveredAt: schema.deliveryOutbox.deliveredAt,
        lastErrorCode: schema.deliveryOutbox.lastErrorCode,
        lastErrorPayload: schema.deliveryOutbox.lastErrorPayload,
        lockedAt: schema.deliveryOutbox.lockedAt,
        leaseExpiresAt: schema.deliveryOutbox.leaseExpiresAt,
        createdAt: schema.deliveryOutbox.createdAt,
        updatedAt: schema.deliveryOutbox.updatedAt,
        folio: schema.leads.publicReference,
        leadStatus: schema.leads.status,
        stateCode: schema.leads.stateCode,
        planCode: schema.leads.planCode,
        leadCreatedAt: schema.leads.createdAt,
        firstNameEnc: schema.leads.firstNameEnc,
        lastNameEnc: schema.leads.lastNameEnc,
        phoneEnc: schema.leads.phoneEnc,
        emailEnc: schema.leads.emailEnc,
        sourceCategory: schema.leadAttribution.sourceCategory,
        utmSource: schema.leadAttribution.firstUtmSource,
        utmMedium: schema.leadAttribution.firstUtmMedium,
        utmCampaign: schema.leadAttribution.firstUtmCampaign,
      })
      .from(schema.deliveryOutbox)
      .innerJoin(schema.leads, eq(schema.deliveryOutbox.leadId, schema.leads.id))
      .leftJoin(schema.leadAttribution, eq(schema.leads.id, schema.leadAttribution.leadId))
      .where(eq(schema.deliveryOutbox.id, id))
      .limit(1);

    if (!row) {
      return NextResponse.json({ error: 'Registro no encontrado' }, { status: 404 });
    }

    let pii: { fullName: string; phone: string; email: string } | null = null;
    if (canViewPii) {
      try {
        pii = {
          fullName: `${decryptPII(row.firstNameEnc)} ${decryptPII(row.lastNameEnc)}`.trim(),
          phone: decryptPII(row.phoneEnc),
          email: decryptPII(row.emailEnc),
        };
      } catch {
        pii = { fullName: '[corrupto]', phone: '[corrupto]', email: '[corrupto]' };
      }
      writeAuditLog({
        session,
        action: 'LEAD_DETAIL_VIEWED',
        targetType: 'lead',
        targetId: row.leadId,
        safeMetadata: { event: 'logs_detail_view', outboxId: row.id },
      }).catch((e) => logError('/api/admin/logs/[id]', 'audit_log', e));
    }

    const errInfo = row.lastErrorCode ? classifyOutboxError(row.lastErrorCode) : null;
    const isDead = row.status === 'dead';
    const isFailed = row.status === 'failed';

    // Un envío fallido con intentos restantes puede re-encolarse manualmente.
    const retryable = canRetry && isFailed && row.attempts < MAX_ATTEMPTS;
    let noRetryNote: string | null = null;
    if (!retryable) {
      if (row.status === 'delivered') noRetryNote = 'Intelix ya aceptó este registro. Un reenvío se rechazaría como duplicado.';
      else if (row.status === 'pending' || row.status === 'processing') noRetryNote = 'El registro ya está en la cola; el cron lo tomará en el siguiente ciclo (cada 5 min).';
      else if (isDead) noRetryNote = `Agotó los ${MAX_ATTEMPTS} intentos${errInfo && !errInfo.retryable ? ' y el error no se resuelve reintentando' : ''}. Requiere captura manual o corregir los datos del lead.`;
      else if (!canRetry) noRetryNote = 'Tu rol no puede re-encolar envíos.';
    }

    // ── Bitácora reconstruida ────────────────────────────────────────────────
    const log: { t: string; at: string; dot: string }[] = [
      { t: 'Solicitud recibida en la landing y encolada para Intelix', at: iso(row.leadCreatedAt), dot: '#16160F' },
    ];
    if (row.attempts > 0) {
      const okLast = row.status === 'delivered';
      log.push({
        t:
          `Intentos de envío: ${row.attempts} de ${MAX_ATTEMPTS}` +
          (okLast
            ? ' · último aceptado (HTTP 200)'
            : row.lastErrorCode
              ? ` · último error: ${row.lastErrorCode}`
              : ''),
        at: iso(row.updatedAt),
        dot: okLast ? '#1B7F4B' : errInfo?.retryable ? '#E0A800' : '#A33A2A',
      });
    }
    if (row.status === 'processing') {
      log.push({ t: 'En proceso · lo está tomando el worker del outbox', at: iso(row.updatedAt), dot: '#C9A227' });
    }
    if (isFailed && row.nextAttemptAt) {
      log.push({ t: 'Próximo reintento automático programado', at: iso(row.nextAttemptAt), dot: '#E0A800' });
    }
    if (row.status === 'pending') {
      log.push({ t: 'En cola · lo tomará el siguiente cron', at: iso(row.updatedAt), dot: '#E0A800' });
    }
    if (isDead) {
      log.push({ t: 'Marcado como definitivo · el cron no volverá a intentarlo', at: iso(row.updatedAt), dot: '#7A2718' });
    }
    if (row.status === 'delivered') {
      log.push({ t: 'Entregado a Intelix', at: iso(row.deliveredAt ?? row.updatedAt), dot: '#1B7F4B' });
    }

    return NextResponse.json({
      id: row.id,
      leadId: row.leadId,
      folio: row.folio,
      status: row.status,
      attempts: row.attempts,
      maxAttempts: MAX_ATTEMPTS,
      nextAttemptAt: row.nextAttemptAt,
      deliveredAt: row.deliveredAt,
      lastErrorCode: row.lastErrorCode,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      leadCreatedAt: row.leadCreatedAt,
      leadStatus: row.leadStatus,
      stateCode: row.stateCode,
      planCode: row.planCode,
      attribution: {
        sourceCategory: row.sourceCategory,
        utmSource: row.utmSource,
        utmMedium: row.utmMedium,
        utmCampaign: row.utmCampaign,
      },
      error: errInfo
        ? { code: row.lastErrorCode, label: errInfo.label, detail: errInfo.detail, retryable: errInfo.retryable, field: errInfo.field ?? null }
        : null,
      // Lo enviado a Intelix (PII enmascarada, ver src/lib/outbox/intelix-log.ts)
      // + la respuesta cruda del proveedor. Puede ser null si nunca hubo un
      // intento fallido registrado, o si el fallo fue antes de construir el
      // payload (p. ej. lead no encontrado).
      lastErrorPayload: row.lastErrorPayload,
      rawResponseAvailable: !!row.lastErrorPayload,
      retryIntervalSeconds: RETRY_INTERVAL_SECONDS,
      pii,
      canViewPii,
      retryable,
      noRetryNote,
      log,
    });
  } catch (err) {
    logError('/api/admin/logs/[id]', 'handler', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}

function iso(d: Date | string | null): string {
  if (!d) return '';
  return typeof d === 'string' ? d : d.toISOString();
}
