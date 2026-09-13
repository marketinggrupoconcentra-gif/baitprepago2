/**
 * src/lib/audit.ts
 *
 * Helper server-side para registrar eventos en app.audit_logs.
 * APPEND-ONLY — NUNCA actualizar ni borrar registros de audit.
 * NUNCA incluir: password, NIP, OTP, tokens, PII, payload completo.
 */
import 'server-only';
import { headers } from 'next/headers';
import { getDb, schema } from '@/db/index';
import { hashHmac } from '@/lib/crypto';
import type { AdminRole } from '@/lib/rbac';
import type { AdminSession } from '@/lib/session';
import { logError } from '@/lib/log';

type AuditAction = typeof schema.auditLogs.$inferInsert['action'];

interface AuditParams {
  session: AdminSession | null;
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  safeMetadata?: Record<string, unknown>;
}

/**
 * Registra un evento de auditoría.
 * Siempre intenta insertar — nunca bloquear la operación principal por error de audit.
 */
export async function writeAuditLog(params: AuditParams): Promise<void> {
  try {
    const reqHeaders = await headers();
    const forwarded = reqHeaders.get('x-forwarded-for');
    const ip = forwarded ? forwarded.split(',')[0].trim() : reqHeaders.get('x-real-ip') ?? 'unknown';
    const ipHash = ip !== 'unknown' 
      ? await hashHmac(ip, process.env.IP_HASH_KEY ?? 'fallback-ip-key')
      : null;

    const db = getDb();
    await db.insert(schema.auditLogs).values({
      actorId: params.session?.userId ?? null,
      actorRole: params.session?.role as AdminRole ?? null,
      action: params.action,
      targetType: params.targetType ?? null,
      targetId: params.targetId ?? null,
      safeMetadata: params.safeMetadata ? JSON.stringify(params.safeMetadata) : null,
      ipHash: ipHash ?? null,
    });
  } catch (err) {
    // Log a consola — nunca lanzar. El audit no debe bloquear la operación principal.
    logError('lib/audit', 'handler', err);
  }
}

export async function writeRequiredAuditLog(params: AuditParams): Promise<void> {
  const reqHeaders = await headers();
  const forwarded = reqHeaders.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0].trim() : reqHeaders.get('x-real-ip') ?? 'unknown';

  const ipKey = process.env.IP_HASH_KEY || (process.env.NODE_ENV === 'development' ? 'dev_fallback_key' : null);
  if (!ipKey) {
    throw new Error('Missing IP_HASH_KEY for required audit operation. Fail closed.');
  }

  const ipHash = ip !== 'unknown' ? await hashHmac(ip, ipKey) : null;

  const db = getDb();
  await db.insert(schema.auditLogs).values({
    actorId: params.session?.userId ?? null,
    actorRole: params.session?.role as AdminRole ?? null,
    action: params.action,
    targetType: params.targetType ?? null,
    targetId: params.targetId ?? null,
    safeMetadata: params.safeMetadata ? JSON.stringify(params.safeMetadata) : null,
    ipHash: ipHash ?? null,
  });
}
