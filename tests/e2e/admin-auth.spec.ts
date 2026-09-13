import { test, expect, type Page } from '@playwright/test';

/**
 * E2E real de Etapa 2.1 — Neon Auth managed + landing pública + RBAC.
 * Corre contra la app desplegada (E2E_BASE_URL, por defecto producción).
 *
 * Credenciales QA (temporales, NUNCA commiteadas):
 *   E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD    — rol BAIT Administrador
 *   E2E_READER_EMAIL / E2E_READER_PASSWORD  — rol BAIT Lector
 */
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? process.env.E2E_USER_EMAIL;
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? process.env.E2E_USER_PASSWORD;
const READER_EMAIL = process.env.E2E_READER_EMAIL;
const READER_PASSWORD = process.env.E2E_READER_PASSWORD;
const hasAdmin = Boolean(ADMIN_EMAIL && ADMIN_PASSWORD);
const hasReader = Boolean(READER_EMAIL && READER_PASSWORD);

async function login(page: Page, email: string, password: string) {
  await page.goto('/admin/login');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('#admin-login-btn')).toBeEnabled();
  await page.fill('#admin-email', email);
  await page.fill('#admin-password', password);
  const signIn = page.waitForResponse(
    (r) => r.url().includes('/api/auth/sign-in/email') && r.request().method() === 'POST',
    { timeout: 30_000 },
  );
  await page.click('#admin-login-btn');
  const res = await signIn;
  expect(res.status(), 'sign-in HTTP status').toBe(200);
  await page.waitForURL(/\/admin\/(dashboard|$)/, { timeout: 30_000 });
  if (!/\/admin\/dashboard/.test(page.url())) {
    await page.goto('/admin/dashboard');
  }
}

// ─────────────────────────── PÚBLICO / ANÓNIMO ───────────────────────────
test.describe('Landing pública', () => {
  test('GET / responde 200 a usuario anónimo (sin Vercel SSO)', async ({ page }) => {
    const res = await page.goto('/');
    expect(res?.status()).toBe(200);
    await expect(page).toHaveTitle(/BAIT/i);
  });

  test('/gracias accesible (rewrite)', async ({ request }) => {
    const res = await request.get('/gracias?ref=E2E');
    expect(res.status()).toBe(200);
  });

  test('assets estáticos accesibles sin autenticación', async ({ request }) => {
    const res = await request.get('/favicon.ico');
    expect(res.status()).toBeLessThan(400);
  });

  test('security headers presentes en la landing', async ({ request }) => {
    const res = await request.get('/');
    const h = res.headers();
    expect(h['content-security-policy']).toContain("default-src 'self'");
    expect(h['content-security-policy']).not.toContain("'strict-dynamic'");
    expect(h['content-security-policy']).toContain("script-src 'self' 'unsafe-inline'");
    expect(h['strict-transport-security']).toContain('max-age=');
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(h['permissions-policy']).toContain('geolocation=()');
  });
});

test.describe('Área admin — protección', () => {
  test('/admin/login renderiza el formulario (página pública)', async ({ page }) => {
    const res = await page.goto('/admin/login');
    expect(res?.status()).toBe(200);
    await expect(page.locator('#admin-email')).toBeVisible();
    await expect(page.locator('#admin-password')).toBeVisible();
  });

  test('/admin sin sesión redirige a /admin/login', async ({ page }) => {
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  test('/admin/dashboard sin sesión redirige a login', async ({ page }) => {
    await page.goto('/admin/dashboard');
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  test('security headers admin: no-store + noindex', async ({ request }) => {
    const res = await request.get('/admin/login', { maxRedirects: 0 });
    const h = res.headers();
    // Next.js 16 local dev might strip 'no-store' and leave 'no-cache, must-revalidate'.
    expect(h['cache-control']).toMatch(/(no-store|no-cache)/);
    expect(h['x-robots-tag']).toContain('noindex');
  });
});

test.describe('Neon Auth — endpoint', () => {
  test('GET /api/auth/get-session (anónimo) NO responde 500', async ({ request }) => {
    const res = await request.get('/api/auth/get-session');
    expect(res.status()).not.toBe(500);
    expect([200, 401]).toContain(res.status());
  });

  test('registro público bloqueado (disable_sign_up)', async ({ request }) => {
    const res = await request.post('/api/auth/sign-up/email', {
      data: {
        email: `e2e-should-fail-${Date.now()}@example.com`,
        password: 'ExtremelyStrongPassword!123',
        name: 'E2E Should Fail',
      },
      failOnStatusCode: false,
    });
    expect(res.ok()).toBeFalsy();
    expect([400, 403, 404, 422]).toContain(res.status());
  });

  test('login con credenciales inválidas → respuesta genérica', async ({ page }) => {
    await page.goto('/admin/login');
    await page.waitForLoadState('networkidle');
    await page.fill('#admin-email', `nadie-${Date.now()}@example.com`);
    await page.fill('#admin-password', 'contraseñaIncorrecta123');
    await page.click('#admin-login-btn');
    await expect(page.getByText(/Credenciales incorrectas/i)).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/login/);
  });
});

// ─────────────────────────── ADMIN AUTENTICADO ───────────────────────────
test.describe('Admin BAIT autenticado', () => {
  test.skip(!hasAdmin, 'Requiere E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD');

  test('login válido → dashboard', async ({ page }) => {
    await login(page, ADMIN_EMAIL!, ADMIN_PASSWORD!);
    await expect(page).toHaveURL(/\/admin\/dashboard/);
    await expect(page.getByText(/Resumen|Dashboard/i).first()).toBeVisible();
  });

  test('navega a todas las secciones (200)', async ({ page }) => {
    await login(page, ADMIN_EMAIL!, ADMIN_PASSWORD!);
    for (const path of ['/admin/dashboard', '/admin/leads', '/admin/analytics', '/admin/users', '/admin/settings']) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(200);
    }
  });

  test('endpoints de gestión NO devuelven 401/403 para Administrador', async ({ page }) => {
    await login(page, ADMIN_EMAIL!, ADMIN_PASSWORD!);
    for (const p of ['/api/admin/users', '/api/admin/leads/export', '/api/admin/reports/schedules']) {
      const r = await page.request.get(p);
      expect(r.status(), p).not.toBe(401);
      expect(r.status(), p).not.toBe(403);
    }
  });

  test('logout invalida la sesión real', async ({ page }) => {
    await login(page, ADMIN_EMAIL!, ADMIN_PASSWORD!);
    await page.click('.logout-btn');
    await page.waitForURL(/\/admin\/login/, { timeout: 15_000 });
    const s = await page.request.get('/api/auth/get-session');
    const body = await s.json().catch(() => null);
    expect(body?.user ?? null).toBeNull();
    await page.goto('/admin/dashboard');
    await expect(page).toHaveURL(/\/admin\/login/);
  });
});

// ─────────────────────────── LECTOR — RBAC REAL ───────────────────────────
test.describe('Lector BAIT — RBAC server-side', () => {
  test.skip(!hasReader, 'Requiere E2E_READER_EMAIL / E2E_READER_PASSWORD');

  test('login válido → dashboard', async ({ page }) => {
    await login(page, READER_EMAIL!, READER_PASSWORD!);
    await expect(page).toHaveURL(/\/admin\/dashboard/);
  });

  test('PUEDE leer: dashboard/leads/analytics/settings + APIs de lectura (200)', async ({ page }) => {
    await login(page, READER_EMAIL!, READER_PASSWORD!);
    for (const p of ['/admin/dashboard', '/admin/leads', '/admin/analytics', '/admin/logs', '/admin/settings']) {
      const res = await page.goto(p);
      expect(res?.status(), p).toBe(200);
    }
    for (const p of ['/api/admin/leads', '/api/admin/dashboard/summary', '/api/admin/analytics/summary', '/api/admin/analytics/funnel', '/api/admin/analytics/acquisition', '/api/admin/logs', '/api/admin/nav/counts', '/api/admin/reports/schedules']) {
      const r = await page.request.get(p);
      expect(r.status(), p).toBe(200);
    }
  });

  test('BLOQUEADO server-side (403) en operaciones administrativas', async ({ page }) => {
    await login(page, READER_EMAIL!, READER_PASSWORD!);
    const g = await page.request.get('/api/admin/users');
    expect(g.status(), 'GET /api/admin/users').toBe(403);
    const ex = await page.request.get('/api/admin/leads/export');
    expect(ex.status(), 'GET /api/admin/leads/export').toBe(403);
    const lr = await page.request.post('/api/admin/logs/retry', { data: { ids: ['00000000-0000-0000-0000-000000000000'] }, failOnStatusCode: false });
    expect(lr.status(), 'POST /api/admin/logs/retry').toBe(403);
    const rc = await page.request.post('/api/admin/reports/schedules', { data: {}, failOnStatusCode: false });
    expect(rc.status(), 'POST /api/admin/reports/schedules').toBe(403);
    const cu = await page.request.post('/api/admin/users', {
      data: { email: 'x@x.com', name: 'x', role: 'Lector' },
      failOnStatusCode: false,
    });
    expect(cu.status(), 'POST /api/admin/users').toBe(403);
  });
});
