import 'server-only';

/**
 * src/lib/log.ts — Logging saneado (SEC-006)
 *
 * Regla: los logs NUNCA deben contener PII, NIP, OTP, proofs, passwords,
 * cookies/tokens de sesión, connection strings, API keys, raw request bodies
 * ni bind params / SQL de errores del driver.
 *
 * `safeError()` reduce cualquier error a un código corto de una allowlist.
 * Usar `logError(route, code, extra?)` en vez de `console.error(msg, err)`.
 */

const ERROR_CLASS_ALLOWLIST = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'SyntaxError',
  'DrizzleQueryError',
  'NeonDbError',
  'PostgresError',
  'AbortError',
  'ZodError',
]);

// Palabras que, si aparecen en un "código", indican fuga potencial → se descartan.
const LEAK_HINTS = /(select |insert |update |delete |from |where |values |password|token|cookie|bearer|postgres:\/\/|postgresql:\/\/|@ep-|sslmode|secret|api[_-]?key|authorization)/i;

export interface SafeError {
  code: string;
  class: string;
}

export function safeError(err: unknown): SafeError {
  const ctorName = err instanceof Error ? err.constructor.name : 'Unknown';
  const nameProp = err instanceof Error ? err.name : '';
  // Preferir el nombre más específico (p.ej. NeonDbError vía err.name sobre 'Error').
  const safeClass =
    nameProp && nameProp !== 'Error' && ERROR_CLASS_ALLOWLIST.has(nameProp)
      ? nameProp
      : ERROR_CLASS_ALLOWLIST.has(ctorName)
        ? ctorName
        : 'Error';

  // Preferir un `code` explícito del error (p.ej. PG SQLSTATE, err.code).
  const raw =
    (err && typeof err === 'object' && 'code' in err && typeof (err as { code: unknown }).code === 'string'
      ? (err as { code: string }).code
      : '') || '';

  let code = raw.trim().slice(0, 32);
  if (!code || LEAK_HINTS.test(code)) code = 'unspecified';
  // Solo caracteres seguros.
  code = code.replace(/[^A-Za-z0-9_.:-]/g, '') || 'unspecified';

  return { code, class: safeClass };
}

/** Log estructurado y seguro para un handler de servidor. */
export function logError(
  route: string,
  where: string,
  err: unknown,
  extra?: Record<string, string | number | boolean | null | undefined>,
): void {
  const s = safeError(err);
  const safeExtra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(extra ?? {})) {
    if (typeof v === 'string' && (LEAK_HINTS.test(v) || v.length > 120)) continue;
    safeExtra[k] = v;
  }
   
  console.error(JSON.stringify({ level: 'error', route, where, err: s, ...safeExtra }));
}

/** Log informativo saneado. */
export function logInfo(
  route: string,
  where: string,
  extra?: Record<string, string | number | boolean | null | undefined>,
): void {
  const safeExtra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(extra ?? {})) {
    if (typeof v === 'string' && (LEAK_HINTS.test(v) || v.length > 120)) continue;
    safeExtra[k] = v;
  }
   
  console.log(JSON.stringify({ level: 'info', route, where, ...safeExtra }));
}
