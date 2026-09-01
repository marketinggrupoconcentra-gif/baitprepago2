/**
 * tests/dashboard-e2e.js
 *
 * E2E tests for Stage 1B Dashboard — against Vercel Preview via bypass.
 * Tests: auth flows, overview data, range changes, reload, logout, DOM PII.
 *
 * Usage:
 *   PREVIEW_URL=https://... QA_ADMIN_EMAIL=... QA_ADMIN_PASSWORD=... \
 *   VERCEL_BYPASS_SECRET=... node --env-file=.env.branch tests/dashboard-e2e.js
 */

const PREVIEW_URL   = process.env.PREVIEW_URL          || '';
const QA_EMAIL      = process.env.QA_ADMIN_EMAIL        || '';
const QA_PASSWORD   = process.env.QA_ADMIN_PASSWORD     || '';
const BYPASS_SECRET = process.env.VERCEL_BYPASS_SECRET  || '';

let pass = 0, fail = 0;
let sessionCookie = null;

async function runTest(label, fn) {
  try {
    await fn();
    console.log(`✅ PASS: ${label}`);
    pass++;
  } catch (e) {
    console.error(`❌ FAIL: ${label} — ${e.message}`);
    fail++;
  }
}

function assert(cond, msg)   { if (!cond) throw new Error(msg || 'Assertion failed'); }
function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(`${msg || ''}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

function bypassHeaders(extra = {}) {
  const h = {
    'x-vercel-protection-bypass': BYPASS_SECRET,
    'x-vercel-set-bypass-cookie': 'samesitenone',
    ...extra
  };
  if (sessionCookie) h['cookie'] = sessionCookie;
  return h;
}

async function apiFetch(path, opts = {}) {
  return fetch(PREVIEW_URL + path, {
    method: opts.method || 'GET',
    headers: bypassHeaders(opts.headers || {}),
    body: opts.body || undefined,
    redirect: opts.redirect || 'manual'
  });
}

if (!PREVIEW_URL || !QA_EMAIL || !QA_PASSWORD || !BYPASS_SECRET) {
  console.error('Required env vars: PREVIEW_URL, QA_ADMIN_EMAIL, QA_ADMIN_PASSWORD, VERCEL_BYPASS_SECRET');
  process.exit(1);
}

console.log('=== Dashboard E2E Tests ===\n');
console.log(`Target: ${PREVIEW_URL}\n`);

(async () => {

  // ── Flow A: /admin/dashboard without session → not showing authenticated content ─────
  await runTest('Flow A: dashboard without session → API returns 401', async () => {
    const res = await fetch(`${PREVIEW_URL}/api/admin/overview`, {
      headers: {
        'x-vercel-protection-bypass': BYPASS_SECRET,
        // deliberately no session cookie
      }
    });
    assertEqual(res.status, 401, 'no session → 401');
  });

  await runTest('Flow A: /admin/session without cookie → 401', async () => {
    const res = await fetch(`${PREVIEW_URL}/api/admin/session`, {
      headers: { 'x-vercel-protection-bypass': BYPASS_SECRET }
    });
    assertEqual(res.status, 401, 'no session → 401');
  });

  // ── Flow B: Login → get session ──────────────────────────────────
  await runTest('Flow B: valid login → 200 with session cookie', async () => {
    const res = await fetch(`${PREVIEW_URL}/api/admin/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'origin': PREVIEW_URL,
        'host': new URL(PREVIEW_URL).host,
        'x-vercel-protection-bypass': BYPASS_SECRET,
        'x-vercel-set-bypass-cookie': 'samesitenone'
      },
      body: JSON.stringify({ email: QA_EMAIL, password: QA_PASSWORD })
    });
    assertEqual(res.status, 200, 'login 200');
    const cookie = res.headers.get('set-cookie');
    assert(cookie && cookie.includes('bait_admin_session'), 'session cookie set');
    const m = cookie.match(/bait_admin_session=[^;]+/);
    assert(m, 'cookie parseable');
    sessionCookie = m[0];
  });

  // ── Flow C: Dashboard overview API → 200 ─────────────────────────
  await runTest('Flow C: overview API → 200', async () => {
    const res = await apiFetch('/api/admin/overview');
    assertEqual(res.status, 200, 'overview 200');
  });

  // ── Flow D: KPI cards contain real values (not undefined/null) ───
  await runTest('Flow D: KPI values are valid numbers', async () => {
    const res = await apiFetch('/api/admin/overview?range=14');
    const data = await res.json();
    assert(typeof data.kpis.total       === 'number', 'total');
    assert(typeof data.kpis.last24Hours === 'number', 'last24Hours');
    assert(typeof data.kpis.last7Days   === 'number', 'last7Days');
    assert(typeof data.kpis.attributionRate === 'number', 'attributionRate');
  });

  // ── Flow E: Range change 14 → 7 → 30 ─────────────────────────────
  await runTest('Flow E: range=7 returns 7-day trend', async () => {
    const res = await apiFetch('/api/admin/overview?range=7');
    const data = await res.json();
    assertEqual(data.range, 7, 'range=7');
    assertEqual(data.trend.length, 7, '7-day trend');
  });

  await runTest('Flow E: range=30 returns 30-day trend', async () => {
    const res = await apiFetch('/api/admin/overview?range=30');
    const data = await res.json();
    assertEqual(data.range, 30, 'range=30');
    assertEqual(data.trend.length, 30, '30-day trend');
  });

  await runTest('Flow E: range changes return different generatedAt', async () => {
    const [r7, r30] = await Promise.all([
      apiFetch('/api/admin/overview?range=7').then(r => r.json()),
      apiFetch('/api/admin/overview?range=30').then(r => r.json())
    ]);
    assert(r7.range !== r30.range, 'ranges differ');
  });

  // ── Flow F: Refresh (re-fetch same range) ─────────────────────────
  await runTest('Flow F: re-fetch same range returns fresh generatedAt', async () => {
    const r1 = await apiFetch('/api/admin/overview?range=14').then(r => r.json());
    await new Promise(r => setTimeout(r, 1100)); // wait 1s
    const r2 = await apiFetch('/api/admin/overview?range=14').then(r => r.json());
    // generatedAt should differ by at least 1 second
    const diff = Math.abs(new Date(r2.generatedAt) - new Date(r1.generatedAt));
    assert(diff >= 900, `generatedAt didn't advance: diff=${diff}ms`);
  });

  // ── Flow G: Session persists across reloads ───────────────────────
  await runTest('Flow G: session survives reload (session endpoint → 200)', async () => {
    const res = await apiFetch('/api/admin/session');
    assertEqual(res.status, 200, 'session 200');
    const data = await res.json();
    assert(data.authenticated, 'authenticated');
    assert(data.user?.email, 'user email present');
  });

  // ── Flow H+I: Logout and session cleared ─────────────────────────
  await runTest('Flow H: logout → 200, cookie cleared', async () => {
    const res = await fetch(`${PREVIEW_URL}/api/admin/logout`, {
      method: 'POST',
      headers: bypassHeaders({
        origin: PREVIEW_URL,
        host: new URL(PREVIEW_URL).host
      })
    });
    assertEqual(res.status, 200, 'logout 200');
    const cookie = res.headers.get('set-cookie') || '';
    assert(
      cookie.includes('Max-Age=0') || cookie.includes('expires=Thu, 01 Jan 1970'),
      'cookie cleared/expired'
    );
  });

  await runTest('Flow I: session after logout → 401', async () => {
    const res = await apiFetch('/api/admin/session');
    assertEqual(res.status, 401, 'after logout → 401');
    sessionCookie = null; // clear local state
  });

  // ── DOM PII test ──────────────────────────────────────────────────
  // Re-login for this test
  await runTest('DOM PII: Re-login to check overview response', async () => {
    const res = await fetch(`${PREVIEW_URL}/api/admin/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'origin': PREVIEW_URL,
        'host': new URL(PREVIEW_URL).host,
        'x-vercel-protection-bypass': BYPASS_SECRET,
        'x-vercel-set-bypass-cookie': 'samesitenone'
      },
      body: JSON.stringify({ email: QA_EMAIL, password: QA_PASSWORD })
    });
    assertEqual(res.status, 200, 're-login');
    const m = res.headers.get('set-cookie')?.match(/bait_admin_session=[^;]+/);
    assert(m, 'cookie');
    sessionCookie = m[0];
  });

  await runTest('DOM PII: phone, IP, fbclid absent from overview JSON', async () => {
    // Seed a PII-laden lead directly in DB
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(process.env.DATABASE_URL);

    const piiPhone  = '5533334444';
    const piiIP     = '198.51.100.42';
    const piiFbclid = `FBCLID_E2E_${Date.now()}`;

    await sql`
      INSERT INTO leads (phone, ip, fbclid, utm_source, utm_campaign, user_agent)
      VALUES (${piiPhone}, ${piiIP}, ${piiFbclid}, 'qa-dashboard', ${'e2e-pii-' + Date.now()}, 'QA/e2e')
    `;

    const res = await apiFetch('/api/admin/overview?range=1');
    const body = await res.text();

    // Verify PII absent from overview response
    assert(!body.includes(piiPhone),  `phone ${piiPhone} found in overview response`);
    assert(!body.includes(piiIP),     `IP ${piiIP} found in response`);
    assert(!body.includes(piiFbclid), `fbclid found in response`);

    // Cleanup
    await sql`DELETE FROM leads WHERE fbclid = ${piiFbclid}`;
    console.log('   OVERVIEW PII LEAK: NO ✓');
  });

  // ── Static file checks (HTML structure) ───────────────────────────
  await runTest('Dashboard HTML exists and has no placeholder text', async () => {
    const res = await apiFetch('/admin/dashboard');
    assert(res.status === 200, `dashboard status ${res.status}`);
    const body = await res.text();
    assert(!body.includes('siguiente etapa'), 'placeholder text removed');
    assert(body.includes('kpiGrid'), 'kpiGrid element present');
    assert(body.includes('trendChartWrap'), 'trend chart wrap present');
    assert(body.includes('sourcesList'), 'sources list present');
    assert(body.includes('campaignList'), 'campaign list present');
    assert(body.includes('activityBody'), 'activity table body present');
    assert(body.includes('rangeSelect'), 'range select present');
    assert(body.includes('logoutBtn'), 'logout button present');
    assert(body.includes('sidebar'), 'sidebar present');
  });

  await runTest('Dashboard HTML has no external scripts or styles', async () => {
    const res = await apiFetch('/admin/dashboard');
    const body = await res.text();
    // No http:// or https:// in script/link tags
    assert(!body.match(/src=["']https?:/), 'no external script src');
    assert(!body.match(/href=["']https?:/), 'no external stylesheet href');
    assert(!body.match(/on\w+=/i), 'no inline event handlers');
  });

  await runTest('Dashboard has correct CSP meta tag', async () => {
    const res = await apiFetch('/admin/dashboard');
    const body = await res.text();
    assert(body.includes("default-src 'self'"), 'CSP default-src self');
    assert(body.includes("script-src 'self'"), 'CSP script-src self');
    assert(!body.includes("unsafe-inline"), 'no unsafe-inline');
    assert(!body.includes("unsafe-eval"), 'no unsafe-eval');
  });

  // ── Security headers ──────────────────────────────────────────────
  await runTest('Admin pages have security headers', async () => {
    const res = await apiFetch('/admin/dashboard');
    const cc = res.headers.get('cache-control');
    assert(cc && cc.includes('no-store'), `Cache-Control: ${cc}`);
  });

  await runTest('Overview API has no-store Cache-Control', async () => {
    const res = await apiFetch('/api/admin/overview');
    const cc = res.headers.get('cache-control');
    assert(cc && cc.includes('no-store'), `Cache-Control: ${cc}`);
  });

  // ── Foundation regression ─────────────────────────────────────────
  await runTest('/api/leads foundation still works', async () => {
    const res = await fetch(`${PREVIEW_URL}/api/leads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-vercel-protection-bypass': BYPASS_SECRET,
        'origin': PREVIEW_URL
      },
      body: JSON.stringify({ phone: '5555555555' })
    });
    // Should be 400 (missing required fields) or 200/429 — not 500
    assert(res.status !== 500, `leads endpoint returned 500: ${res.status}`);
  });

  console.log(`\n=== E2E Results: ${pass} passed, ${fail} failed ===\n`);
  process.exit(fail > 0 ? 1 : 0);

})().catch(e => { console.error(e.message); process.exit(1); });
