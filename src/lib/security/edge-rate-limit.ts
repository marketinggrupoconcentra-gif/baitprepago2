/**
 * src/lib/security/edge-rate-limit.ts
 *
 * Rate limiter EN MEMORIA para el edge (`proxy.ts`). Ventana fija por clave.
 *
 * Propósito: freno anti-abuso barato ANTES de que el request llegue a una
 * Function (protege contra ráfagas / DoS-lite / scraping agresivo sin pagar
 * un round-trip a Postgres en cada request).
 *
 * Limitaciones asumidas a propósito:
 *   - Estado por instancia (no distribuido). Vercel reutiliza instancias con
 *     Fluid Compute, así que en la práctica atrapa a los abusadores rápidos.
 *   - NO sustituye al rate limiter distribuido de Postgres (`rate-limiter.ts`),
 *     que sigue siendo la autoridad para leads / OTP.
 *   - Nunca persiste ni loguea la IP; el Map es efímero.
 */

interface Bucket {
  count: number;
  resetAt: number; // epoch ms
}

const store = new Map<string, Bucket>();

// Cota dura de memoria: si se supera, se barren las entradas vencidas.
const MAX_KEYS = 50_000;

export interface EdgeLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfter: number; // segundos
}

function sweep(now: number): void {
  for (const [key, bucket] of store) {
    if (bucket.resetAt <= now) store.delete(key);
  }
}

/**
 * Consume una unidad de cuota para `key`. Devuelve si se permite el request.
 * @param key      identificador de agrupación (p.ej. `api:1.2.3.4`)
 * @param limit    máximo de requests por ventana
 * @param windowSecs duración de la ventana en segundos
 */
export function edgeRateLimit(key: string, limit: number, windowSecs: number): EdgeLimitResult {
  const now = Date.now();
  const windowMs = windowSecs * 1000;

  let bucket = store.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    store.set(key, bucket);
  }

  bucket.count += 1;

  if (store.size > MAX_KEYS) sweep(now);

  if (bucket.count > limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }

  return {
    allowed: true,
    remaining: Math.max(0, limit - bucket.count),
    retryAfter: 0,
  };
}

/** Sólo para tests: vacía el estado en memoria. */
export function __resetEdgeRateLimit(): void {
  store.clear();
}
