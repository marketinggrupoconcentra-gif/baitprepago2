import 'server-only';
import { getDb, schema } from '@/db';
import { lt, sql } from 'drizzle-orm';
import { logError } from '@/lib/log';

// ── Rate Limiter DISTRIBUIDO (Postgres / Neon) — SEC-004 ─────────────────────
// Sin Redis / KV. Ventana de bucket fijo por (scope, key_hash, bucket_start).
// El incremento es una única sentencia atómica:
//   INSERT ... ON CONFLICT DO UPDATE SET count = count + 1 RETURNING count
// key_hash NUNCA es IP en claro — se pasa hashIp(ip) o blindIndex(phone).

export interface RateLimitConfig {
  name: string;      // scope, ej: 'leads', 'admin-export'
  limit: number;     // máximo de requests en la ventana
  windowSecs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;         // epoch ms
  retryAfterSecs: number;
  degraded?: boolean;      // true si el limitador falló y se aplicó fail-mode
}

function bucketStart(windowMs: number): Date {
  return new Date(Math.floor(Date.now() / windowMs) * windowMs);
}

/**
 * Evalúa y consume una unidad de cuota de forma atómica en Postgres.
 * `failMode`:
 *   - 'closed' (default para leads): si la DB falla → NO permitir.
 *   - 'open'   (analytics no crítico): si la DB falla → permitir (degradado).
 */
export async function checkRateLimit(
  keyHash: string,
  config: RateLimitConfig,
  failMode: 'closed' | 'open' = 'closed',
): Promise<RateLimitResult> {
  const windowMs = config.windowSecs * 1000;
  const start = bucketStart(windowMs);
  const resetAt = start.getTime() + windowMs;
  const expiresAt = new Date(resetAt + windowMs); // TTL: bucket + una ventana de gracia

  try {
    const db = getDb();
    const rows = await db
      .insert(schema.rateLimits)
      .values({ scope: config.name, keyHash, bucketStart: start, count: 1, expiresAt })
      .onConflictDoUpdate({
        target: [schema.rateLimits.scope, schema.rateLimits.keyHash, schema.rateLimits.bucketStart],
        set: { count: sql`${schema.rateLimits.count} + 1` },
      })
      .returning({ count: schema.rateLimits.count });

    const count = rows[0]?.count ?? config.limit + 1;
    const allowed = count <= config.limit;
    return {
      allowed,
      remaining: Math.max(0, config.limit - count),
      resetAt,
      retryAfterSecs: allowed ? 0 : Math.ceil((resetAt - Date.now()) / 1000),
    };
  } catch (err) {
    logError('rate-limiter', config.name, err, { failMode });
    if (failMode === 'open') {
      return { allowed: true, remaining: 0, resetAt, retryAfterSecs: 0, degraded: true };
    }
    return {
      allowed: false,
      remaining: 0,
      resetAt,
      retryAfterSecs: Math.ceil((resetAt - Date.now()) / 1000),
      degraded: true,
    };
  }
}

/** Limpieza best-effort de buckets vencidos (llamar desde un cron). */
export async function purgeExpiredRateLimits(): Promise<number> {
  try {
    const db = getDb();
    const rows = await db
      .delete(schema.rateLimits)
      .where(lt(schema.rateLimits.expiresAt, new Date()))
      .returning({ scope: schema.rateLimits.scope });
    return rows.length;
  } catch {
    return 0;
  }
}

// Configuraciones predefinidas (valores conservados de Etapa 1).
export const RATE_LIMITS = {
  leads:        { name: 'leads',           limit: 5,  windowSecs: 60 } satisfies RateLimitConfig,
  events:       { name: 'events',          limit: 60, windowSecs: 60 } satisfies RateLimitConfig,
  // Anti-exfiltración: export de CSV de leads (PII). Fail-closed, por (admin+ip).
  exportCsv:    { name: 'admin-export',    limit: 6,   windowSecs: 300 } satisfies RateLimitConfig,
  // Listado de leads en el panel — generoso, sólo corta scraping por bucle.
  adminList:    { name: 'admin-list',      limit: 120, windowSecs: 60 } satisfies RateLimitConfig,
} as const;
