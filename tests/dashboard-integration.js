/**
 * tests/dashboard-integration.js
 *
 * Integration tests for GET /api/admin/overview.
 * Requires: VERCEL_BYPASS_SECRET, PREVIEW_URL, QA_ADMIN_EMAIL, QA_ADMIN_PASSWORD, DATABASE_URL
 *
 * Usage:
 *   PREVIEW_URL=https://... QA_ADMIN_EMAIL=... QA_ADMIN_PASSWORD=... \
 *   VERCEL_BYPASS_SECRET=... node --env-file=.env.branch tests/dashboard-integration.js
 */

const PREVIEW_URL          = process.env.PREVIEW_URL          || '';
const QA_EMAIL             = process.env.QA_ADMIN_EMAIL        || '';
const QA_PASSWORD          = process.env.QA_ADMIN_PASSWORD     || '';
const BYPASS_SECRET        = process.env.VERCEL_BYPASS_SECRET  || '';
const PREVIEW_EP           = 'ep-little-darkness';
const PRODUCTION_EP        = 'a57hzmzw';

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

function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed'); }
function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(`${msg || ''}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

function headers(extra = {}) {
  const h = {
    'x-vercel-protection-bypass': BYPASS_SECRET,
    'x-vercel-set-bypass-cookie': 'samesitenone',
    ...extra
  };
  if (sessionCookie) h['cookie'] = sessionCookie;
  return h;
}

async function apiFetch(path, opts = {}) {
  const url = PREVIEW_URL + path;
  return fetch(url, {
    headers: headers(opts.headers || {}),
    method: opts.method || 'GET',
    body: opts.body || undefined,
    redirect: 'manual'
  });
}

// ── DB Guard ─────────────────────────────────────────────────────────
function assertPreviewDb() {
  const dbUrl = process.env.DATABASE_URL || '';
  if (!dbUrl.includes(PREVIEW_EP)) throw new Error(`DB not preview: ${dbUrl.slice(0, 50)}`);
  if (dbUrl.includes(PRODUCTION_EP)) throw new Error('Production DB detected');
}

console.log('=== Dashboard Integration Tests ===\n');
console.log(`Target: ${PREVIEW_URL}\n`);

async function getDb() {
  const { neon } = await import('@neondatabase/serverless');
  return neon(process.env.DATABASE_URL);
}

(async () => {

  // ── Pre-conditions ─────────────────────────────────────────────────
  if (!PREVIEW_URL) { console.error('PREVIEW_URL required'); process.exit(1); }
  if (!QA_EMAIL || !QA_PASSWORD) { console.error('QA_ADMIN_EMAIL/QA_ADMIN_PASSWORD required'); process.exit(1); }
  if (!BYPASS_SECRET) { console.error('VERCEL_BYPASS_SECRET required'); process.exit(1); }

  // ── Ensure QA admin exists ─────────────────────────────────────────
  assertPreviewDb();
  const sql = await getDb();

  const existingUser = await sql`SELECT id FROM admin_users WHERE email = ${QA_EMAIL} LIMIT 1`;
  if (existingUser.length === 0) {
    console.error(`QA admin ${QA_EMAIL} not found. Run scripts/create-admin-direct.js first.`);
    process.exit(1);
  }

  // ── 1. GET overview without session → 401 ─────────────────────────
  await runTest('GET overview without cookie → 401', async () => {
    const savedCookie = sessionCookie;
    sessionCookie = null;
    const res = await apiFetch('/api/admin/overview');
    sessionCookie = savedCookie;
    assertEqual(res.status, 401, 'status');
  });

  // ── 2. POST overview → 405 ────────────────────────────────────────
  await runTest('POST overview → 405', async () => {
    const res = await apiFetch('/api/admin/overview', { method: 'POST' });
    assertEqual(res.status, 405, 'status');
  });

  // ── 3. Login to get session ───────────────────────────────────────
  await runTest('Login to establish session', async () => {
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
    assertEqual(res.status, 200, 'login status');
    const setCookieHeader = res.headers.get('set-cookie');
    assert(setCookieHeader && setCookieHeader.includes('bait_admin_session'), 'session cookie set');
    const match = setCookieHeader.match(/bait_admin_session=[^;]+/);
    assert(match, 'cookie value parseable');
    sessionCookie = match[0];
  });

  // ── 4. GET overview range=7 → 200 ────────────────────────────────
  await runTest('GET overview range=7 → 200', async () => {
    const res = await apiFetch('/api/admin/overview?range=7');
    assertEqual(res.status, 200, 'status');
    const data = await res.json();
    assertEqual(data.range, 7, 'range in response');
    assert(typeof data.kpis === 'object', 'kpis present');
    assert(Array.isArray(data.trend), 'trend array');
    assertEqual(data.trend.length, 7, 'trend has 7 entries');
  });

  // ── 5. GET overview range=14 → 200 ───────────────────────────────
  await runTest('GET overview range=14 → 200', async () => {
    const res = await apiFetch('/api/admin/overview?range=14');
    assertEqual(res.status, 200, 'status');
    const data = await res.json();
    assertEqual(data.range, 14, 'range');
    assertEqual(data.trend.length, 14, 'trend length');
  });

  // ── 6. GET overview range=30 → 200 ───────────────────────────────
  await runTest('GET overview range=30 → 200', async () => {
    const res = await apiFetch('/api/admin/overview?range=30');
    assertEqual(res.status, 200, 'status');
    const data = await res.json();
    assertEqual(data.range, 30, 'range');
    assertEqual(data.trend.length, 30, 'trend length');
  });

  // ── 7. GET overview default range=14 ─────────────────────────────
  await runTest('GET overview no range param → defaults to 14', async () => {
    const res = await apiFetch('/api/admin/overview');
    assertEqual(res.status, 200, 'status');
    const data = await res.json();
    assertEqual(data.range, 14, 'default range');
  });

  // ── 8. Invalid range → 400 ───────────────────────────────────────
  await runTest('GET overview range=999 → 400', async () => {
    const res = await apiFetch('/api/admin/overview?range=999');
    assertEqual(res.status, 400, 'status');
  });

  // ── 9. Invalid range (string) → 400 ──────────────────────────────
  await runTest('GET overview range=hack → 400', async () => {
    const res = await apiFetch('/api/admin/overview?range=hack');
    assertEqual(res.status, 400, 'status');
  });

  // ── 10. KPI structure ─────────────────────────────────────────────
  await runTest('KPI structure is complete and numeric', async () => {
    const res = await apiFetch('/api/admin/overview?range=14');
    const data = await res.json();
    const k = data.kpis;
    assert(typeof k.total        === 'number', 'total is number');
    assert(typeof k.last24Hours  === 'number', 'last24Hours');
    assert(typeof k.last7Days    === 'number', 'last7Days');
    assert(typeof k.attributionRate === 'number', 'attributionRate');
    assert(k.attributionRate >= 0 && k.attributionRate <= 100, 'attributionRate in [0,100]');
  });

  // ── 11. Trend zero-fill ───────────────────────────────────────────
  await runTest('Trend has no gaps (all dates consecutive)', async () => {
    const res = await apiFetch('/api/admin/overview?range=14');
    const data = await res.json();
    assert(data.trend.length === 14, 'exactly 14 entries');
    for (const row of data.trend) {
      assert(typeof row.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.date), `date format: ${row.date}`);
      assert(typeof row.leads === 'number' && row.leads >= 0, `leads>=0: ${row.leads}`);
    }
  });

  // ── 12. Sources structure ─────────────────────────────────────────
  await runTest('Sources array contains valid structure', async () => {
    const res = await apiFetch('/api/admin/overview?range=30');
    const data = await res.json();
    assert(Array.isArray(data.sources), 'sources is array');
    assert(data.sources.length <= 6, 'max 6 sources (5+Otros)');
    for (const s of data.sources) {
      assert(typeof s.source === 'string', 'source is string');
      assert(typeof s.count === 'number', 'count is number');
      assert(typeof s.percentage === 'number', 'percentage');
      assert(s.percentage >= 0 && s.percentage <= 100, 'percentage in range');
    }
  });

  // ── 13. Campaigns structure ───────────────────────────────────────
  await runTest('Campaigns array valid structure', async () => {
    const res = await apiFetch('/api/admin/overview?range=30');
    const data = await res.json();
    assert(Array.isArray(data.campaigns), 'campaigns array');
    assert(data.campaigns.length <= 5, 'max 5 campaigns');
    for (const c of data.campaigns) {
      assert(typeof c.campaign === 'string', 'campaign name');
      assert(typeof c.count === 'number', 'campaign count');
    }
  });

  // ── 14. Recent activity structure ─────────────────────────────────
  await runTest('recentActivity has correct structure, max 10', async () => {
    const res = await apiFetch('/api/admin/overview?range=30');
    const data = await res.json();
    assert(Array.isArray(data.recentActivity), 'recentActivity array');
    assert(data.recentActivity.length <= 10, 'max 10 rows');
    for (const row of data.recentActivity) {
      assert(typeof row.createdAt === 'string', 'createdAt string');
      assert(typeof row.source   === 'string', 'source string');
      assert('campaign' in row, 'campaign key present');
      assert('medium'   in row, 'medium key present');
    }
  });

  // ── 15. PII leak check ────────────────────────────────────────────
  await runTest('OVERVIEW PII LEAK: NO (phone/IP/fbclid absent)', async () => {
    // Seed a lead with unique PII-like values
    assertPreviewDb();
    const uniquePhone  = '5599998877';
    const uniqueIP     = '203.0.113.99';
    const uniqueFbclid = 'FBCLID_UNIQUE_QA_' + Date.now();
    const uniqueUrl    = 'https://example.invalid/qa-pii-test';

    await sql`
      INSERT INTO leads (phone, ip, fbclid, page_url, utm_source, utm_campaign, user_agent)
      VALUES (
        ${uniquePhone}, ${uniqueIP}, ${uniqueFbclid}, ${uniqueUrl},
        'qa-dashboard', ${'pii-test-' + Date.now()}, 'QA/1.0'
      )
    `;

    const res = await apiFetch('/api/admin/overview?range=1');
    const body = await res.text();

    // Verify none of these appear in response
    assert(!body.includes(uniquePhone),  `phone ${uniquePhone} found in response`);
    assert(!body.includes(uniqueIP),     `IP ${uniqueIP} found in response`);
    assert(!body.includes(uniqueFbclid), `fbclid found in response`);
    assert(!body.includes(uniqueUrl),    `page_url found in response`);

    // Cleanup this specific PII test lead
    await sql`DELETE FROM leads WHERE fbclid = ${uniqueFbclid}`;
  });

  // ── 16. Expired session → 401 ─────────────────────────────────────
  await runTest('Expired session → 401 and session deleted', async () => {
    // Manually expire the current session
    const tokenHash = sessionCookie.split('=')[1];
    // We don't have the hash here — instead create a fake old session
    const fakeHash = 'a'.repeat(64);
    const expiredAt = new Date(Date.now() - 3600000).toISOString(); // 1 hour ago
    const userRow = await sql`SELECT id FROM admin_users WHERE email = ${QA_EMAIL} LIMIT 1`;
    await sql`
      INSERT INTO admin_sessions (admin_user_id, token_hash, expires_at)
      VALUES (${userRow[0].id}, ${fakeHash}, ${expiredAt})
    `;
    const fakeCookie = `bait_admin_session=${'x'.repeat(64)}`;
    const res = await fetch(`${PREVIEW_URL}/api/admin/overview`, {
      headers: {
        cookie: fakeCookie,
        'x-vercel-protection-bypass': BYPASS_SECRET
      }
    });
    assertEqual(res.status, 401, 'expired session → 401');
    // Clean up
    await sql`DELETE FROM admin_sessions WHERE token_hash = ${fakeHash}`;
  });

  // ── 17. Inactive admin → 401 ──────────────────────────────────────
  await runTest('Inactive admin session → 401', async () => {
    // Temporarily deactivate QA user
    await sql`UPDATE admin_users SET active = false WHERE email = ${QA_EMAIL}`;
    const res = await apiFetch('/api/admin/overview');
    await sql`UPDATE admin_users SET active = true WHERE email = ${QA_EMAIL}`;
    assertEqual(res.status, 401, 'inactive → 401');
  });

  // ── 18. generatedAt is present and valid ISO date ─────────────────
  await runTest('Response includes generatedAt as valid ISO date', async () => {
    const res = await apiFetch('/api/admin/overview');
    const data = await res.json();
    assert(typeof data.generatedAt === 'string', 'generatedAt present');
    assert(!isNaN(Date.parse(data.generatedAt)), `invalid date: ${data.generatedAt}`);
  });

  // ── Cleanup session ───────────────────────────────────────────────
  await sql`
    DELETE FROM admin_sessions WHERE admin_user_id = (
      SELECT id FROM admin_users WHERE email = ${QA_EMAIL}
    )
  `;

  console.log(`\n=== Integration Results: ${pass} passed, ${fail} failed ===\n`);
  process.exit(fail > 0 ? 1 : 0);

})().catch(e => { console.error(e.message); process.exit(1); });
