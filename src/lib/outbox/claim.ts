/**
 * src/lib/outbox/claim.ts
 *
 * Extracted outbox claim/process/success/retry/dead logic.
 * Used by both the cron route and integration tests.
 * Source of truth for FLW-003/FLW-004 claim SQL.
 */
import 'server-only';
import { getDb, schema, withTransaction } from '@/db';
import { classifyOutboxError } from '@/lib/outbox/errors';
import { eq, sql } from 'drizzle-orm';

/**
 * Reintento de entrega a Intelix.
 *
 * REGLA: cuando Intelix falla o tarda en responder, el registro se vuelve a
 * intentar **cada 5 minutos** — exactamente una vuelta del cron
 * (`*​/5 * * * *` en vercel.json → GET /api/cron/outbox) — hasta `MAX_ATTEMPTS`.
 * Intervalo FIJO (no backoff exponencial): si el proveedor está caído una hora,
 * habrá ~12 intentos espaciados 5 min.
 *
 * Un error PERMANENTE (NIP inválido, teléfono duplicado, compañía no elegible…)
 * NO se reintenta: pasa a `dead` en el primer fallo (ver classifyOutboxError).
 */
export const MAX_ATTEMPTS = 12;
export const RETRY_INTERVAL_SECONDS = 300; // 5 min — igual que la cadencia del cron
export const DEFAULT_BATCH = 25;
export const DEFAULT_LEASE_SECONDS = 120;

export type ClaimedRow = { id: string; lead_id: string; attempts: number };

/**
 * Claim eligible outbox rows atomically.
 * FLW-003: filters terminal states BEFORE LIMIT.
 * FLW-004: FOR UPDATE SKIP LOCKED → concurrent workers never process the same row.
 */
export async function claimOutboxBatch(options?: {
  batch?: number;
  leaseSeconds?: number;
  workerId?: string;
  destination?: string;
}): Promise<ClaimedRow[]> {
  const batch = options?.batch ?? DEFAULT_BATCH;
  const leaseSeconds = options?.leaseSeconds ?? DEFAULT_LEASE_SECONDS;
  const workerId = options?.workerId ?? crypto.randomUUID();
  const destination = options?.destination ?? 'intelix';
  const db = getDb();

  const claimRes = await db.execute(sql`
    WITH candidates AS (
      SELECT id
      FROM app.delivery_outbox
      WHERE destination = ${destination}
        AND attempts < ${MAX_ATTEMPTS}
        AND (
          (status IN ('pending','failed') AND (next_attempt_at IS NULL OR next_attempt_at <= now()))
          OR (status = 'processing' AND lease_expires_at IS NOT NULL AND lease_expires_at < now())
        )
      ORDER BY next_attempt_at ASC NULLS FIRST
      LIMIT ${batch}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE app.delivery_outbox o
    SET status = 'processing',
        locked_at = now(),
        lease_expires_at = now() + (${leaseSeconds} || ' seconds')::interval,
        locked_by = ${workerId},
        updated_at = now()
    FROM candidates c
    WHERE o.id = c.id
    RETURNING o.id, o.lead_id, o.attempts
  `);

  return ((claimRes as unknown as { rows?: ClaimedRow[] }).rows ?? []) as ClaimedRow[];
}

/**
 * Mark an outbox entry as delivered.
 */
export async function markDelivered(entryId: string, leadId: string, attempt: number): Promise<void> {
  const now = new Date();
  await withTransaction(async (tx) => {
    await tx.update(schema.deliveryOutbox)
      .set({ status: 'delivered', deliveredAt: now, attempts: attempt, leaseExpiresAt: null, lockedAt: null, lockedBy: null, updatedAt: now })
      .where(eq(schema.deliveryOutbox.id, entryId));
    await tx.update(schema.leads).set({ status: 'delivered', updatedAt: now }).where(eq(schema.leads.id, leadId));
    // El NIP solo existía para esta entrega: se borra en cuanto Intelix lo acepta.
    await tx.delete(schema.leadSecrets).where(eq(schema.leadSecrets.leadId, leadId));
  });
}

/**
 * Marca una entrada del outbox como `failed` (se reintentará en 5 min) o `dead`.
 *
 * `dead` cuando:
 *   - se alcanzó `MAX_ATTEMPTS`, o
 *   - el error es permanente (no se resuelve reintentando — p. ej. NIP inválido,
 *     teléfono duplicado, compañía no elegible).
 * En cualquier otro caso (timeout, 5xx, red, credenciales) → `failed` con
 * `next_attempt_at = now() + 5 min`, listo para la siguiente vuelta del cron.
 */
export async function markFailed(entryId: string, leadId: string, attempt: number, errorCode: string, payload?: unknown): Promise<void> {
  const now = new Date();
  const { retryable } = classifyOutboxError(errorCode);
  const isDead = attempt >= MAX_ATTEMPTS || !retryable;

  await withTransaction(async (tx) => {
    await tx.update(schema.deliveryOutbox)
      .set({
        status: isDead ? 'dead' : 'failed',
        attempts: attempt,
        nextAttemptAt: isDead ? null : new Date(Date.now() + RETRY_INTERVAL_SECONDS * 1000),
        lastErrorCode: errorCode,
        lastErrorPayload: payload || null,
        leaseExpiresAt: null, lockedAt: null, lockedBy: null,
        updatedAt: now,
      })
      .where(eq(schema.deliveryOutbox.id, entryId));

    if (isDead) {
      await tx.update(schema.leads).set({ status: 'failed', updatedAt: now }).where(eq(schema.leads.id, leadId));
    }
  });
}
