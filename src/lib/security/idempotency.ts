import 'server-only';
import { getDb } from '@/db';
import { schema } from '@/db';
import { eq, and, gt } from 'drizzle-orm';
import { hashPayload } from '@/lib/crypto';

// ── Idempotency ───────────────────────────────────────────────────────────────
// Separa TECHNICAL IDEMPOTENCY (misma key → mismo resultado)
// de BUSINESS DEDUPLICATION (mismo teléfono → rechazar dentro de ventana).

export interface IdempotencyResult {
  /** true → request ya fue procesada, devolver el cached reference */
  isDuplicate: boolean;
  /** Referencia previa si isDuplicate = true */
  cachedReference?: string;
  /** true → misma key pero payload distinto → rechazar */
  isConflict?: boolean;
}

/**
 * Verifica si ya existe una entrada para esta idempotency key.
 * TECHNICAL IDEMPOTENCY: misma key = mismo resultado, seguro repetir.
 */
export async function checkIdempotency(
  key: string,
  endpoint: string,
  payload: unknown
): Promise<IdempotencyResult> {
  const db = getDb();
  const now = new Date();

  const existing = await db
    .select()
    .from(schema.idempotencyKeys)
    .where(
      and(
        eq(schema.idempotencyKeys.idempotencyKey, key),
        eq(schema.idempotencyKeys.endpoint, endpoint),
        gt(schema.idempotencyKeys.expiresAt, now)
      )
    )
    .limit(1);

  if (existing.length === 0) {
    return { isDuplicate: false };
  }

  const entry = existing[0];
  const payloadHash = hashPayload(payload);

  // Misma key + payload distinto → CONFLICT
  if (entry.requestHash !== payloadHash) {
    return { isDuplicate: false, isConflict: true };
  }

  // Misma key + mismo payload → devolver resultado previo
  return {
    isDuplicate: true,
    cachedReference: entry.responseReference ?? undefined,
  };
}

/**
 * Registra una idempotency key DESPUÉS de procesar exitosamente.
 */
export async function saveIdempotencyKey(
  key: string,
  endpoint: string,
  payload: unknown,
  responseReference: string
): Promise<void> {
  const db = getDb();
  const payloadHash = hashPayload(payload);
  const windowHours = Number(process.env.LEAD_DEDUPE_WINDOW_HOURS ?? 24);
  const expiresAt = new Date(Date.now() + windowHours * 60 * 60 * 1000);

  await db.insert(schema.idempotencyKeys).values({
    idempotencyKey: key,
    endpoint,
    requestHash: payloadHash,
    responseReference,
    expiresAt,
  }).onConflictDoNothing();
}
