import 'server-only';

// ── Origin / Same-Site Validation ─────────────────────────────────────────────
// Protege la API de llamadas directas desde fuera del dominio.
// La allowlist se construye dinámicamente desde variables de entorno,
// evitando hardcodear dominios que pueden cambiar.

function buildAllowedOrigins(): Set<string> {
  const origins = new Set<string>();

  // 1. APP_URL — dominio principal de producción (REQUIRED en producción)
  const appUrl = process.env.APP_URL;
  if (appUrl) {
    try {
      const u = new URL(appUrl);
      origins.add(u.origin);
    } catch {
      console.warn('[origin] APP_URL con formato inválido (valor no registrado).');
    }
  }

  // 2. ALLOWED_ORIGINS — lista adicional separada por coma
  //    Ejemplo: https://baitprepago2.vercel.app,https://portabilidadbait.com
  const extra = process.env.ALLOWED_ORIGINS ?? '';
  for (const raw of extra.split(',')) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    try {
      const u = new URL(trimmed);
      origins.add(u.origin);
    } catch {
      console.warn('[origin] ALLOWED_ORIGINS contiene una URL con formato inválido (valor no registrado).');
    }
  }

  // 3. VERCEL_URL y VERCEL_PROJECT_PRODUCTION_URL (auto-inyectados por Vercel)
  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl) {
    try {
      origins.add(new URL(`https://${vercelUrl}`).origin);
    } catch {}
  }
  const vercelProdUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercelProdUrl) {
    try {
      origins.add(new URL(`https://${vercelProdUrl}`).origin);
    } catch {}
  }

  // 4. NEXT_PUBLIC_VERCEL_URL (auto-inyectado en preview/production si está configurado)
  const nextVercelUrl = process.env.NEXT_PUBLIC_VERCEL_URL;
  if (nextVercelUrl) {
    try {
      origins.add(new URL(`https://${nextVercelUrl}`).origin);
    } catch {}
  }

  return origins;
}

// Construido una vez al arranque del servidor — inmutable en runtime.
const ALLOWED_ORIGINS = buildAllowedOrigins();

export interface OriginResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Valida que el Origin de la request sea nuestro propio dominio.
 * - En development local: se permite sin origen (curl, Postman, integration tests).
 * - En producción: el Origin debe estar en la allowlist construida desde env vars.
 * - NO acepta wildcards ni cualquier subdominio de .vercel.app.
 */
export function checkOrigin(
  originHeader: string | null,
  refererHeader: string | null,
  hostHeader?: string | null
): OriginResult {
  // En desarrollo local: permitir requests sin origin (herramientas de dev)
  if (process.env.NODE_ENV !== 'production') {
    return { allowed: true };
  }

  // 0. Si el origen coincide exactamente con el Host del request, es Same-Origin.
  // Esto soluciona problemas con dominios dinámicos de Vercel que no están en env vars.
  if (originHeader && hostHeader) {
    try {
      const originHost = new URL(originHeader).host;
      if (originHost === hostHeader) {
        return { allowed: true };
      }
    } catch {}
  }

  // Si la allowlist está vacía en producción, y no fue Same-Origin, bloquear.
  if (ALLOWED_ORIGINS.size === 0) {
    console.error('[origin] CRITICAL: ALLOWED_ORIGINS vacía en producción. Bloquear todo.');
    return { allowed: false, reason: 'no_allowed_origins_configured' };
  }

  // En producción: el Origin debe estar en la allowlist
  if (!originHeader) {
    // Algunos browsers omiten Origin en same-origin requests de navegación.
    // Intentar con Referer como fallback.
    if (refererHeader) {
      try {
        const refUrl = new URL(refererHeader);
        const refOrigin = refUrl.origin;
        if (hostHeader && refUrl.host === hostHeader) return { allowed: true };
        if (ALLOWED_ORIGINS.has(refOrigin)) return { allowed: true };
      } catch {
        // Referer malformado — ignorar
      }
    }
    return { allowed: false, reason: 'missing_origin' };
  }

  if (!ALLOWED_ORIGINS.has(originHeader)) {
    return { allowed: false, reason: 'invalid_origin' };
  }

  return { allowed: true };
}
