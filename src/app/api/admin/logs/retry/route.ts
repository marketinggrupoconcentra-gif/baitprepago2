/**
 * POST /api/admin/logs/retry — Re-encola envíos fallidos del delivery_outbox
 *
 * Requiere: logs.retry
 * Body: { ids: string[] }  (1..50 ids de app.delivery_outbox)
 *
 * Sólo re-encola filas en estado `failed` con intentos < MAX_ATTEMPTS:
 *   status → 'pending', next_attempt_at → now()  (el cron la tomará en ≤5 min)
 * NO toca `attempts` (respeta el tope) ni reintenta filas `dead`/`delivered`.
 * Idéntico efecto que esperar el intervalo de reintento (5 min), sólo que inmediato.
 *
 * Auditado: OUTBOX_RETRY_QUEUED (una entrada por lote, con el conteo).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb, schema } from '@/db/index';
import { requireAdminSession } from '@/lib/session';
import { and, eq, inArray, lt } from 'drizzle-orm';
import { logError, logInfo } from '@/lib/log';
import { writeAuditLog } from '@/lib/audit';
import { MAX_ATTEMPTS } from '@/lib/outbox/claim';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BATCH = 50;

export async function POST(req: NextRequest): Promise<NextResponse> {
  let session;
  try {
    session = await requireAdminSession('logs.retry');
  } catch (res) {
    return res as NextResponse;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const rawIds = (body as { ids?: unknown })?.ids;
  const ids = Array.isArray(rawIds)
    ? Array.from(new Set(rawIds.filter((x): x is string => typeof x === 'string' && UUID_RE.test(x))))
    : [];

  if (ids.length === 0) {
    return NextResponse.json({ error: 'Sin ids válidos' }, { status: 400 });
  }
  if (ids.length > MAX_BATCH) {
    return NextResponse.json({ error: `Máximo ${MAX_BATCH} por lote` }, { status: 400 });
  }

  try {
    const db = getDb();
    const now = new Date();

    const updated = await db
      .update(schema.deliveryOutbox)
      .set({
        status: 'pending',
        nextAttemptAt: now,
        lockedAt: null,
        leaseExpiresAt: null,
        lockedBy: null,
        updatedAt: now,
      })
      .where(
        and(
          inArray(schema.deliveryOutbox.id, ids),
          eq(schema.deliveryOutbox.destination, 'intelix'),
          eq(schema.deliveryOutbox.status, 'failed'),
          lt(schema.deliveryOutbox.attempts, MAX_ATTEMPTS),
        ),
      )
      .returning({ id: schema.deliveryOutbox.id, leadId: schema.deliveryOutbox.leadId });

    const requeued = updated.length;
    const skipped = ids.length - requeued;

    if (requeued > 0) {
      await writeAuditLog({
        session,
        action: 'OUTBOX_RETRY_QUEUED',
        targetType: 'delivery_outbox',
        targetId: requeued === 1 ? updated[0].id : undefined,
        safeMetadata: { requeued, skipped, ids: updated.map((u) => u.id) },
      });
      logInfo('/api/admin/logs/retry', 'requeued', { requeued, skipped, by: session.userId });
    }

    return NextResponse.json({
      ok: true,
      requeued,
      skipped,
      message:
        requeued === 0
          ? 'Ningún registro era re-encolable (sólo aplica a envíos fallidos con intentos disponibles).'
          : `${requeued} envío${requeued === 1 ? '' : 's'} re-encolado${requeued === 1 ? '' : 's'}. El cron los tomará en ≤5 min.`,
    });
  } catch (err) {
    logError('/api/admin/logs/retry', 'handler', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
