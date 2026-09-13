/**
 * src/lib/security/edge-guard.ts
 *
 * Decisión de admisión en el EDGE (invocada desde `proxy.ts` en cada request).
 * Combina las firmas de `bot-signatures` con el rate limiter en memoria.
 *
 * Política (definida con el equipo):
 *   - Crawlers de IA / entrenamiento           → BLOQUEAR (403) en todas las rutas.
 *   - Herramientas ofensivas (sqlmap, nikto…)  → BLOQUEAR (403).
 *   - Sondas de exploit (`/.env`, `/wp-…`)     → 404 (no confirmar existencia).
 *   - Cliente sospechoso (curl/scrapy/headers) → THROTTLE agresivo (no deny).
 *   - Resto                                    → cota por IP generosa.
 *
 * Es fail-open y sin dependencias de red: si algo falla, se permite el request
 * (las capas de aplicación siguen aplicando origin + bot + rate limit distribuido).
 */
import {
  classifyUserAgent,
  isExploitProbe,
  looksStatic,
  hasBotishHeaders,
} from './bot-signatures';
import { edgeRateLimit } from './edge-rate-limit';

function envInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** Límites por IP (ventana de 60s). Ajustables vía env. */
const LIMITS = {
  strict: { limit: envInt(process.env.EDGE_RL_STRICT, 12), window: 60 }, // clientes sospechosos
  api: { limit: envInt(process.env.EDGE_RL_API, 80), window: 60 },       // /api/* normal
  page: { limit: envInt(process.env.EDGE_RL_PAGE, 240), window: 60 },    // páginas / navegación
};

export type EdgeAction =
  | { type: 'allow' }
  | { type: 'block'; status: number; code: string }
  | { type: 'throttle'; retryAfter: number; code: string };

export interface EdgeRequestInfo {
  pathname: string;
  method: string;
  headers: Headers;
  ip: string;
}

export function evaluateEdge(req: EdgeRequestInfo): EdgeAction {
  const { pathname, headers, ip } = req;

  const isApi = pathname.startsWith('/api/');
  const isAuth = pathname.startsWith('/api/auth');
  const isAdminUi = pathname === '/admin' || pathname.startsWith('/admin/');
  const uaClass = classifyUserAgent(headers.get('user-agent'));

  // 1. Crawlers de IA → bloqueados en todas partes (política).
  if (uaClass === 'ai-crawler') {
    return { type: 'block', status: 403, code: 'ai_crawler_blocked' };
  }

  // 2. Herramientas ofensivas → bloqueadas.
  if (uaClass === 'malicious-tool') {
    return { type: 'block', status: 403, code: 'malicious_tool_blocked' };
  }

  // 3. Sondas de exploit / rutas de secretos → 404 (nunca bajo /api/auth).
  if (!isAuth && isExploitProbe(pathname)) {
    return { type: 'block', status: 404, code: 'exploit_probe' };
  }

  // 4. Assets estáticos: los checks baratos ya corrieron; no consumir cuota.
  if (!isApi && looksStatic(pathname)) {
    return { type: 'allow' };
  }

  const key = ip || 'unknown';

  // 5. Endpoints de auth: Neon Auth tiene su propio throttling; sólo cota IP.
  if (isAuth) {
    const r = edgeRateLimit(`auth:${key}`, LIMITS.api.limit, LIMITS.api.window);
    return r.allowed
      ? { type: 'allow' }
      : { type: 'throttle', retryAfter: r.retryAfter, code: 'edge_rate_limit' };
  }

  // 6. Cliente sospechoso → throttle agresivo (no deny: evita falsos positivos duros).
  const suspicious = uaClass === 'automation' || (isApi && hasBotishHeaders(headers));
  if (suspicious) {
    const r = edgeRateLimit(`strict:${key}`, LIMITS.strict.limit, LIMITS.strict.window);
    if (!r.allowed) {
      return { type: 'throttle', retryAfter: r.retryAfter, code: 'suspicious_client_throttled' };
    }
  }

  // 7. Cota por IP normal.
  const scope = isApi || isAdminUi ? 'api' : 'page';
  const bucket = scope === 'api' ? LIMITS.api : LIMITS.page;
  const r = edgeRateLimit(`${scope}:${key}`, bucket.limit, bucket.window);
  if (!r.allowed) {
    return { type: 'throttle', retryAfter: r.retryAfter, code: 'edge_rate_limit' };
  }

  return { type: 'allow' };
}

/** Extrae la IP de cliente desde las cabeceras del proxy de Vercel. */
export function edgeClientIp(headers: Headers): string {
  const fwd = headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return headers.get('x-real-ip') ?? 'unknown';
}
