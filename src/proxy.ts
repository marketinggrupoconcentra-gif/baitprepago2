import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { evaluateEdge, edgeClientIp } from '@/lib/security/edge-guard';

// ── CSP con nonce por request (Next.js 16) ───────────────────────────────────
// script-src usa 'nonce-<n>' + 'strict-dynamic' (NUNCA 'unsafe-inline'):
//   - Next.js firma sus bootstrap scripts inline con el nonce que publicamos
//     vía el header de request Content-Security-Policy (lo detecta y lo aplica).
//   - 'strict-dynamic' permite que el runtime (ya confiado por nonce) cargue
//     GTM / GA4 / Meta Pixel, que se inyectan por JS (document.createElement).
//   - La allowlist de hosts queda como fallback para navegadores sin strict-dynamic.
// El uso de nonce fuerza render dinámico (no se puede hornear en build).
function buildCSP(nonce: string, staticLanding = false): string {
  const isDev = process.env.NODE_ENV === 'development';

  const analyticsHosts = [
    'https://www.googletagmanager.com',
    'https://ssl.google-analytics.com',
    'https://www.google-analytics.com',
    'https://analytics.google.com',
    'https://connect.facebook.net',
    'https://www.facebook.com',
    'https://cdn.jsdelivr.net',
  ];

  // La landing legacy ("/" y "/gracias") es HTML ESTÁTICO servido desde public/:
  // su <script src> y su <script> inline no pueden llevar un nonce por request.
  // 'strict-dynamic' anula 'self'/'unsafe-inline', así que para esas rutas se usa
  // una allowlist clásica (sin nonce, sin strict-dynamic) o el navegador bloquea
  // TODO el JS del formulario.
  const scriptSrc = staticLanding
    ? ["'self'", "'unsafe-inline'", ...analyticsHosts, ...(isDev ? ["'unsafe-eval'"] : [])]
    : [
        "'self'",
        `'nonce-${nonce}'`,
        "'strict-dynamic'",
        // Fallbacks (ignorados por navegadores que aplican strict-dynamic):
        ...analyticsHosts,
        ...(isDev ? ["'unsafe-eval'"] : []),
      ];

  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': scriptSrc,
    'style-src': [
      "'self'",
      "'unsafe-inline'", // estilos inline de la landing + Tailwind
      'https://fonts.googleapis.com',
      'https://cdn.jsdelivr.net',
    ],
    'font-src': ["'self'", 'https://fonts.gstatic.com', 'https://cdn.jsdelivr.net'],
    'img-src': [
      "'self'",
      'data:',
      'https://www.google-analytics.com',
      'https://www.googletagmanager.com',
      'https://www.facebook.com',
      'https://www.google.com',
      'https://www.google.com.mx',
      // Google Ads conversion pixels
      'https://ad.doubleclick.net',
      'https://googleads.g.doubleclick.net',
      'https://stats.g.doubleclick.net',
    ],
    'connect-src': [
      "'self'",
      'https://www.google-analytics.com',
      'https://analytics.google.com',
      'https://stats.g.doubleclick.net',
      'https://www.facebook.com',
      'https://www.googletagmanager.com',
      // Google Ads Conversion Measurement (GTM tags: /ccm/collect)
      'https://www.google.com',
      'https://www.google.com.mx',
      'https://ad.doubleclick.net',
      // Señales de conversión de Google Ads (Enhanced Conversions)
      'https://googleads.g.doubleclick.net',
      ...(isDev ? ['ws://localhost:*', 'http://localhost:*'] : []),
    ],
    'frame-src': [
      'https://www.googletagmanager.com',
      'https://bid.g.doubleclick.net',
      'https://ad.doubleclick.net',
    ],
    'frame-ancestors': ["'none'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'upgrade-insecure-requests': [],
  };

  return Object.entries(directives)
    .map(([k, v]) => (v.length ? `${k} ${v.join(' ')}` : k))
    .join('; ');
}

function applySecurityHeaders(
  res: NextResponse,
  csp: string,
  isAdmin: boolean,
  isApi = false,
  isNonProd = false,
): NextResponse {
  res.headers.set('Content-Security-Policy', csp);
  res.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  // Nada bajo /api ni /admin debe indexarse (anti-scraping vía buscadores).
  // En cualquier deploy que NO sea producción (previews *.vercel.app, staging),
  // TODO el sitio va noindex para que el alias técnico nunca compita con el
  // dominio canónico portabilidadbait.com.
  if (isAdmin || isApi || isNonProd) {
    res.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  }
  if (isAdmin) {
    res.headers.set('Cache-Control', 'private, no-store, no-cache, must-revalidate');
  }
  return res;
}

// Rutas servidas como HTML estático desde public/legacy (zona protegida).
const STATIC_LANDING_RE = /^\/(?:|gracias|duplicado|aviso-de-privacidad|walmart-beneficios)\/?$/;

const PUBLIC_ADMIN_PATHS = [
  '/admin/login',
  '/admin/forgot-password',
  '/admin/reset-password',
];

const NEON_SESSION_COOKIES = [
  '__Secure-neon-auth.session_token',
  'neon-auth.session_token',
];

// Middleware oficial de Neon Auth (refresh de sesión + protección de rutas admin).
// La AUTORIZACIÓN real vive en getAdminSession() (sesión + admin_profiles + RBAC).
let _neonAdminGuard: ReturnType<typeof auth.middleware> | null = null;
function neonAdminGuard(req: NextRequest) {
  if (!_neonAdminGuard) _neonAdminGuard = auth.middleware({ loginUrl: '/admin/login' });
  return _neonAdminGuard(req);
}

function makeNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

export async function proxy(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;
  const isAdmin = pathname.startsWith('/admin');
  const isApi = pathname.startsWith('/api');
  const isAdminPublic = PUBLIC_ADMIN_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
  const isApiAuth = pathname.startsWith('/api/auth');
  // La landing BAIT Prepago y sus páginas secundarias se reescriben a HTML
  // ESTÁTICO (public/legacy/*) vía next.config.ts. Sus <script src> no pueden
  // llevar nonce por request → CSP sin 'strict-dynamic' para esas rutas, o el
  // navegador bloquea TODO el JS del formulario (public/assets/site.js).
  const isStaticLanding = STATIC_LANDING_RE.test(pathname);

  // Preview / staging: nunca indexable. `VERCEL_ENV` es 'production' sólo en el
  // deploy de producción; los previews son 'preview' y el host es *.vercel.app.
  const vercelEnv = process.env.VERCEL_ENV;
  const host = req.headers.get('host') ?? '';
  const isNonProd =
    (typeof vercelEnv === 'string' && vercelEnv !== 'production') ||
    host.endsWith('.vercel.app');

  // Páginas estáticas secundarias: URL canónica con "/" final (rutas relativas del HTML).
  if (isStaticLanding && pathname !== '/' && !pathname.endsWith('/')) {
    // new URL (no NextURL): NextURL normaliza y quita la barra final.
    return NextResponse.redirect(new URL(pathname + '/' + req.nextUrl.search, req.url), 308);
  }

  const nonce = makeNonce();
  const csp = buildCSP(nonce, isStaticLanding);

  // ── Admisión en el edge (anti-scraping / anti-bot / freno anti-DoS) ────────
  // Corre ANTES de cualquier Function. Fail-open: si lanza, se continúa.
  try {
    const decision = evaluateEdge({
      pathname,
      method: req.method,
      headers: req.headers,
      ip: edgeClientIp(req.headers),
    });

    if (decision.type === 'block') {
      const body = decision.status === 404 ? { error: 'Not Found' } : { error: 'Forbidden' };
      return applySecurityHeaders(
        NextResponse.json(body, { status: decision.status }),
        csp,
        isAdmin,
        isApi,
      );
    }

    if (decision.type === 'throttle') {
      const res = NextResponse.json({ error: 'Demasiadas solicitudes.' }, { status: 429 });
      res.headers.set('Retry-After', String(decision.retryAfter));
      res.headers.set('X-RateLimit-Scope', 'edge');
      return applySecurityHeaders(res, csp, isAdmin, isApi);
    }
  } catch {
    // El edge-guard nunca debe tumbar el request. Las capas de app siguen activas.
  }

  // Headers que Next.js lee para aplicar el nonce a sus scripts inline.
  const fwd = new Headers(req.headers);
  fwd.set('x-nonce', nonce);
  fwd.set('Content-Security-Policy', csp);
  const nextOpts = { request: { headers: fwd } };

  // Área admin protegida → guard de Neon Auth.
  if (isAdmin && !isAdminPublic && !isApiAuth) {
    const hasSessionCookie = NEON_SESSION_COOKIES.some((c) => req.cookies.has(c));
    if (!hasSessionCookie) {
      const loginUrl = new URL('/admin/login', req.url);
      loginUrl.searchParams.set('next', pathname);
      return applySecurityHeaders(NextResponse.redirect(loginUrl), csp, true);
    }

    const guarded = await neonAdminGuard(req);
    // Si el guard redirige (sin sesión válida) lo respetamos.
    if (guarded.status >= 300 && guarded.status < 400 && guarded.headers.has('location')) {
      return applySecurityHeaders(guarded, csp, true);
    }
    // Pass-through: propagar cookies de sesión refrescadas + inyectar nonce.
    const res = NextResponse.next(nextOpts);
    guarded.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'set-cookie') res.headers.append('set-cookie', value);
    });
    return applySecurityHeaders(res, csp, true, false, isNonProd);
  }

  // Landing estática: la analítica de terceros (GTM/GA4/Pixel) la carga
  // public/assets/js/bait-analytics.js leyendo GET /api/analytics/config —
  // no se inyecta nada en el HTML (la landing no tiene placeholders).
  return applySecurityHeaders(NextResponse.next(nextOpts), csp, isAdmin, isApi, isNonProd);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|legacy/).*)'],
};
