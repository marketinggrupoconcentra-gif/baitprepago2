/**
 * tests/admin-e2e.js
 * 
 * E2E tests for admin auth flows against Vercel Preview.
 * Tests: login, session, brute force, logout, session expiry, inactive user, dashboard gate.
 * 
 * Required env vars:
 *   PREVIEW_URL         - e.g. https://baitprepago2-54loaiasl-lid-marketing.vercel.app
 *   QA_ADMIN_EMAIL      - e.g. qa-admin@bait.invalid
 *   QA_ADMIN_PASSWORD   - QA password (never logged)
 *   VERCEL_BYPASS_SECRET - Protection bypass secret
 *   DATABASE_URL         - Preview Neon DB (for direct verification)
 */

import { neon } from '@neondatabase/serverless';

const PREVIEW_URL = process.env.PREVIEW_URL;
const QA_EMAIL = (process.env.QA_ADMIN_EMAIL || 'qa-admin@bait.invalid').toLowerCase();
const QA_PASSWORD = process.env.QA_ADMIN_PASSWORD;
const BYPASS = process.env.VERCEL_BYPASS_SECRET;
const DB_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const EXPECTED_ENDPOINT = 'ep-little-darkness';

// Validate required vars
if (!PREVIEW_URL || !QA_PASSWORD || !BYPASS || !DB_URL) {
  console.error('❌ Missing required env vars: PREVIEW_URL, QA_ADMIN_PASSWORD, VERCEL_BYPASS_SECRET, DATABASE_URL');
  process.exit(1);
}

if (!DB_URL.includes(EXPECTED_ENDPOINT) || DB_URL.includes('a57hzmzw')) {
  console.error('❌ DATABASE_URL references wrong Neon branch. Aborting.');
  process.exit(1);
}

const sql = neon(DB_URL);

let passCount = 0;
let failCount = 0;
let sessionCookie = null;

async function runTest(name, fn) {
  try {
    await fn();
    console.log(`✅ PASS: ${name}`);
    passCount++;
  } catch (e) {
    console.error(`❌ FAIL: ${name} — ${e.message}`);
    failCount++;
  }
}

// fetch with bypass header and optional cookie
async function apiFetch(path, options = {}) {
  const headers = {
    'x-vercel-protection-bypass': BYPASS,
    'origin': PREVIEW_URL,
    ...(options.headers || {})
  };
  
  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }
  
  if (sessionCookie && !options.noCookie) {
    headers['Cookie'] = sessionCookie;
  }
  
  const resp = await fetch(`${PREVIEW_URL}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    redirect: 'manual'
  });
  
  return resp;
}

function extractCookie(resp) {
  const setCookie = resp.headers.get('set-cookie');
  if (setCookie && setCookie.includes('bait_admin_session=') && !setCookie.includes('bait_admin_session=;')) {
    return setCookie.split(';')[0].trim(); // returns "bait_admin_session=<token>"
  }
  return null;
}

async function runTests() {
  console.log('=== Admin E2E Tests ===');
  console.log(`Target: ${PREVIEW_URL}\n`);

  // ─── 1. Clean up any leftover QA attempts before starting ──────────────────

  await sql`DELETE FROM admin_login_attempts WHERE 1=1`;
  await sql`DELETE FROM admin_sessions WHERE admin_user_id IN (SELECT id FROM admin_users WHERE email = ${QA_EMAIL})`;
  console.log('Pre-test cleanup: OK\n');

  // ─── 2. LOGIN FAILED — wrong password ──────────────────────────────────────

  await runTest('Wrong password → 401', async () => {
    const resp = await apiFetch('/api/admin/login', {
      method: 'POST',
      body: { email: QA_EMAIL, password: 'WrongPassword!!!' },
      noCookie: true
    });
    if (resp.status !== 401) throw new Error(`Expected 401, got ${resp.status}`);
    const data = await resp.json();
    if (!data.error || data.error !== 'Invalid email or password') {
      throw new Error(`Unexpected error message: ${data.error}`);
    }
  });

  // ─── 3. USER ENUMERATION — unknown email ───────────────────────────────────

  await runTest('Unknown email → 401 with same generic message', async () => {
    const resp = await apiFetch('/api/admin/login', {
      method: 'POST',
      body: { email: 'nonexistent@example.com', password: 'SomePassword123!' },
      noCookie: true
    });
    if (resp.status !== 401) throw new Error(`Expected 401, got ${resp.status}`);
    const data = await resp.json();
    if (data.error !== 'Invalid email or password') {
      throw new Error(`Unexpected error (enumeration risk): ${data.error}`);
    }
  });

  // ─── 4. LOGIN FAILED DB audit ──────────────────────────────────────────────

  await runTest('Failed login creates HMAC-based attempt records (no raw IP/email)', async () => {
    // Verify attempts exist
    const attempts = await sql`SELECT kind, key_hash, attempts FROM admin_login_attempts`;
    if (attempts.length < 2) throw new Error(`Expected ≥2 attempt rows, got ${attempts.length}`);
    
    // Verify no raw IP or email stored
    for (const a of attempts) {
      if (a.key_hash === QA_EMAIL) throw new Error('Raw email found in key_hash!');
      if (/^\d{1,3}\.\d{1,3}/.test(a.key_hash)) throw new Error('Raw IP found in key_hash!');
      if (!a.kind || !['IP', 'ACCOUNT'].includes(a.kind)) throw new Error(`Invalid kind: ${a.kind}`);
    }
    
    // Check audit log
    const audit = await sql`
      SELECT action, actor_hash, metadata FROM admin_audit_log
      WHERE action = 'LOGIN_FAILED'
      ORDER BY created_at DESC LIMIT 1
    `;
    if (audit.length === 0) throw new Error('LOGIN_FAILED audit not found');
    // Verify no PII in audit
    const meta = JSON.stringify(audit[0].metadata || {});
    if (meta.includes(QA_EMAIL)) throw new Error('Email found in audit metadata!');
    if (meta.includes('password')) throw new Error('password key found in audit metadata!');
  });

  // ─── 5. ON CONFLICT confirmation — no 500 ─────────────────────────────────

  await runTest('Second failed login does not 500 (ON CONFLICT works)', async () => {
    const resp = await apiFetch('/api/admin/login', {
      method: 'POST',
      body: { email: QA_EMAIL, password: 'WrongPassword2!!!' },
      noCookie: true
    });
    if (resp.status === 500) throw new Error('Got 500 — ON CONFLICT likely broken');
    if (resp.status !== 401 && resp.status !== 429) {
      throw new Error(`Unexpected status: ${resp.status}`);
    }
  });

  // ─── 6. BRUTE FORCE — lock at attempt 5 ───────────────────────────────────

  await runTest('Brute force: 5 attempts triggers 429', async () => {
    // Clear previous attempts
    await sql`DELETE FROM admin_login_attempts`;
    
    let lastStatus;
    for (let i = 1; i <= 6; i++) {
      const resp = await apiFetch('/api/admin/login', {
        method: 'POST',
        body: { email: QA_EMAIL, password: `WrongBrute${i}!!!` },
        noCookie: true
      });
      lastStatus = resp.status;
      if (i >= 5 && resp.status === 429) break; // Got locked
    }
    
    if (lastStatus !== 429) throw new Error(`Expected 429 after brute force, got ${lastStatus}`);
    
    // Verify lock stored in DB
    const locked = await sql`
      SELECT kind, locked_until FROM admin_login_attempts
      WHERE locked_until > CURRENT_TIMESTAMP
    `;
    if (locked.length === 0) throw new Error('No lock record in DB after brute force');
  });

  // ─── 7. CLEAR LOCK before happy path ──────────────────────────────────────

  console.log('Clearing QA rate-limit lock...');
  await sql`DELETE FROM admin_login_attempts`;
  console.log('Lock cleared: OK');

  // ─── 8. SQL INJECTION ──────────────────────────────────────────────────────

  await runTest("SQL injection in email does not bypass auth or return 500", async () => {
    const resp = await apiFetch('/api/admin/login', {
      method: 'POST',
      body: { email: "' OR 1=1 --", password: 'any' },
      noCookie: true
    });
    if (resp.status === 500) throw new Error('Got 500 — possible SQL error from injection');
    if (resp.status === 200) throw new Error('Got 200 — auth bypass! CRITICAL');
    // Should be 400 or 401
    if (![400, 401, 429].includes(resp.status)) {
      throw new Error(`Unexpected status: ${resp.status}`);
    }
  });

  // ─── 9. VALID LOGIN ────────────────────────────────────────────────────────

  await runTest('Valid login → 200 with correct cookie attributes', async () => {
    const resp = await apiFetch('/api/admin/login', {
      method: 'POST',
      body: { email: QA_EMAIL, password: QA_PASSWORD },
      noCookie: true
    });
    
    if (resp.status !== 200) {
      const text = await resp.text();
      throw new Error(`Expected 200, got ${resp.status}: ${text}`);
    }
    
    const data = await resp.json();
    if (!data.ok) throw new Error('Expected {ok:true} in response body');
    
    // Extract and verify cookie
    const setCookieHeader = resp.headers.get('set-cookie');
    if (!setCookieHeader) throw new Error('No Set-Cookie header');
    if (!setCookieHeader.includes('HttpOnly')) throw new Error('Missing HttpOnly flag');
    if (!setCookieHeader.includes('Secure')) throw new Error('Missing Secure flag');
    if (!setCookieHeader.includes('SameSite=Strict')) throw new Error('Missing SameSite=Strict');
    if (!setCookieHeader.includes('Path=/')) throw new Error('Missing Path=/');
    
    // Token must NOT be in response body
    const bodyStr = JSON.stringify(data);
    if (bodyStr.includes('token') || bodyStr.includes('session')) {
      throw new Error('Session token found in response body!');
    }
    
    // Save session cookie for subsequent tests
    sessionCookie = extractCookie(resp);
    if (!sessionCookie) throw new Error('Could not extract session cookie from Set-Cookie header');
  });

  // ─── 10. SESSION DB VERIFICATION ──────────────────────────────────────────

  await runTest('Session created in DB: token_hash present, plaintext absent', async () => {
    const sessions = await sql`
      SELECT s.token_hash, s.expires_at
      FROM admin_sessions s
      JOIN admin_users u ON s.admin_user_id = u.id
      WHERE u.email = ${QA_EMAIL}
    `;
    if (sessions.length === 0) throw new Error('No session in DB after login');
    
    const session = sessions[0];
    // Verify token_hash is a sha256 hex (64 chars)
    if (!/^[0-9a-f]{64}$/.test(session.token_hash)) {
      throw new Error(`token_hash format wrong: ${session.token_hash.substring(0,10)}...`);
    }
    
    // Verify plaintext token is NOT in DB (it should only be sha256 hash)
    // The cookie value is "bait_admin_session=<TOKEN>"
    const cookieToken = sessionCookie.split('=')[1];
    if (session.token_hash === cookieToken) {
      throw new Error('Plaintext token stored in DB! Only hash should be stored.');
    }
    
    // Verify expiry ~8 hours from now
    const expiresAt = new Date(session.expires_at);
    const sevenHoursFromNow = new Date(Date.now() + 7 * 60 * 60 * 1000);
    if (expiresAt < sevenHoursFromNow) {
      throw new Error(`Session expires too soon: ${expiresAt.toISOString()}`);
    }
  });

  // ─── 11. SESSION ENDPOINT ─────────────────────────────────────────────────

  await runTest('GET /api/admin/session → 200 with user info (no sensitive data)', async () => {
    const resp = await apiFetch('/api/admin/session');
    if (resp.status !== 200) throw new Error(`Expected 200, got ${resp.status}`);
    const data = await resp.json();
    if (!data.authenticated) throw new Error('Expected authenticated=true');
    if (!data.user || !data.user.email || !data.user.role) throw new Error('Missing user fields');
    if (data.user.email !== QA_EMAIL) throw new Error(`Wrong email: ${data.user.email}`);
    if (data.user.role !== 'SUPER_ADMIN') throw new Error(`Wrong role: ${data.user.role}`);
    // Ensure no sensitive data
    const body = JSON.stringify(data);
    if (body.includes('password') || body.includes('token') || body.includes('hash')) {
      throw new Error('Sensitive data in session response!');
    }
  });

  // ─── 12. DASHBOARD GATE (unauthenticated) ─────────────────────────────────

  await runTest('Dashboard without session → page does not render authenticated content', async () => {
    const resp = await apiFetch('/admin/dashboard', { noCookie: true });
    // The page itself renders (200) but dashboard.js then redirects via JS
    // We check via /api/admin/session without cookie → 401
    const sessionResp = await apiFetch('/api/admin/session', { noCookie: true });
    if (sessionResp.status !== 401) throw new Error(`Expected 401 for session without cookie, got ${sessionResp.status}`);
  });

  // ─── 13. RELOAD ───────────────────────────────────────────────────────────

  await runTest('Session survives reload (DB-backed)', async () => {
    const resp = await apiFetch('/api/admin/session');
    if (resp.status !== 200) throw new Error(`Session not found after reload: ${resp.status}`);
    const data = await resp.json();
    if (!data.authenticated) throw new Error('Not authenticated after reload');
  });

  // ─── 14. LOGOUT ───────────────────────────────────────────────────────────

  await runTest('POST /api/admin/logout → 200, session deleted, cookie cleared', async () => {
    const resp = await apiFetch('/api/admin/logout', { method: 'POST' });
    if (resp.status !== 200) throw new Error(`Expected 200, got ${resp.status}`);
    
    // Verify cookie cleared
    const setCookie = resp.headers.get('set-cookie');
    if (!setCookie || !setCookie.includes('bait_admin_session=;')) {
      throw new Error('Cookie not properly cleared on logout');
    }
    
    // Verify session deleted from DB
    const sessions = await sql`
      SELECT admin_sessions.id FROM admin_sessions
      JOIN admin_users ON admin_sessions.admin_user_id = admin_users.id
      WHERE admin_users.email = ${QA_EMAIL}
    `;
    if (sessions.length > 0) throw new Error('Session still in DB after logout!');
    
    // Verify LOGOUT audit
    const audit = await sql`
      SELECT action FROM admin_audit_log
      WHERE action = 'LOGOUT'
      ORDER BY created_at DESC LIMIT 1
    `;
    if (audit.length === 0) throw new Error('LOGOUT audit not recorded');
  });

  // ─── 15. SECOND LOGOUT (idempotent) ───────────────────────────────────────

  await runTest('Second logout → 200 (idempotent)', async () => {
    const resp = await apiFetch('/api/admin/logout', { method: 'POST' });
    if (resp.status !== 200) throw new Error(`Expected 200 on second logout, got ${resp.status}`);
  });

  // ─── 16. SESSION AFTER LOGOUT ─────────────────────────────────────────────

  await runTest('GET /api/admin/session after logout → 401', async () => {
    const resp = await apiFetch('/api/admin/session');
    if (resp.status !== 401) throw new Error(`Expected 401, got ${resp.status}`);
  });

  // ─── 17. EXPIRED SESSION SIMULATION ───────────────────────────────────────

  await runTest('Expired session → 401 and session deleted', async () => {
    // Login fresh
    const loginResp = await apiFetch('/api/admin/login', {
      method: 'POST',
      body: { email: QA_EMAIL, password: QA_PASSWORD },
      noCookie: true
    });
    if (loginResp.status !== 200) throw new Error(`Login failed: ${loginResp.status}`);
    const freshCookie = extractCookie(loginResp);
    
    // Manually expire the session in DB
    await sql`
      UPDATE admin_sessions
      SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 minute'
      WHERE admin_user_id IN (SELECT id FROM admin_users WHERE email = ${QA_EMAIL})
    `;
    
    // Save original session cookie and set the fresh one
    const originalCookie = sessionCookie;
    sessionCookie = freshCookie;
    
    const resp = await apiFetch('/api/admin/session');
    if (resp.status !== 401) {
      sessionCookie = originalCookie;
      throw new Error(`Expected 401 for expired session, got ${resp.status}`);
    }
    
    // Verify session was deleted
    const sessions = await sql`
      SELECT id FROM admin_sessions
      WHERE admin_user_id IN (SELECT id FROM admin_users WHERE email = ${QA_EMAIL})
        AND expires_at < CURRENT_TIMESTAMP
    `;
    if (sessions.length > 0) throw new Error('Expired session not deleted from DB');
    
    sessionCookie = originalCookie;
  });

  // ─── 18. INACTIVE USER SESSION ────────────────────────────────────────────

  await runTest('Inactive user session → 401 and session invalidated', async () => {
    // Login fresh
    const loginResp = await apiFetch('/api/admin/login', {
      method: 'POST',
      body: { email: QA_EMAIL, password: QA_PASSWORD },
      noCookie: true
    });
    if (loginResp.status !== 200) throw new Error(`Login failed: ${loginResp.status}`);
    const freshCookie = extractCookie(loginResp);
    
    // Deactivate user
    await sql`UPDATE admin_users SET active = false WHERE email = ${QA_EMAIL}`;
    
    const originalCookie = sessionCookie;
    sessionCookie = freshCookie;
    
    const resp = await apiFetch('/api/admin/session');
    
    // Re-activate user before checking result
    await sql`UPDATE admin_users SET active = true WHERE email = ${QA_EMAIL}`;
    sessionCookie = originalCookie;
    
    if (resp.status !== 401) throw new Error(`Expected 401 for inactive user, got ${resp.status}`);
  });

  // ─── 19. AUDIT LOG VERIFICATION ───────────────────────────────────────────

  await runTest('Audit log contains required events with no PII or secrets', async () => {
    const audits = await sql`
      SELECT action, actor_hash, metadata FROM admin_audit_log
      WHERE admin_user_id IN (SELECT id FROM admin_users WHERE email = ${QA_EMAIL})
      ORDER BY created_at
    `;
    
    const actions = audits.map(a => a.action);
    if (!actions.includes('LOGIN_FAILED')) throw new Error('LOGIN_FAILED missing from audit');
    if (!actions.includes('LOGIN_SUCCESS')) throw new Error('LOGIN_SUCCESS missing from audit');
    if (!actions.includes('LOGOUT')) throw new Error('LOGOUT missing from audit');
    
    for (const a of audits) {
      const meta = JSON.stringify(a.metadata || {});
      if (meta.toLowerCase().includes('password')) throw new Error('password in audit metadata');
      if (a.metadata && a.metadata.token) throw new Error('token in audit metadata');
      // actor_hash should not be raw email or IP
      if (a.actor_hash === QA_EMAIL) throw new Error('Raw email as actor_hash');
      if (/^\d{1,3}\.\d{1,3}/.test(a.actor_hash)) throw new Error('Raw IP as actor_hash');
    }
  });

  // ─── 20. ADMIN HEADERS ────────────────────────────────────────────────────

  await runTest('Admin pages have correct security headers', async () => {
    const resp = await apiFetch('/admin', { noCookie: true });
    
    const cacheControl = resp.headers.get('cache-control');
    if (!cacheControl || !cacheControl.includes('no-store')) {
      throw new Error(`Cache-Control wrong: ${cacheControl}`);
    }
    
    const robots = resp.headers.get('x-robots-tag');
    if (!robots || !robots.includes('noindex')) {
      throw new Error(`X-Robots-Tag wrong: ${robots}`);
    }
    
    const csp = resp.headers.get('content-security-policy');
    if (!csp) throw new Error('CSP header missing');
    if (!csp.includes("default-src 'self'")) throw new Error(`CSP missing default-src 'self': ${csp}`);
    if (!csp.includes("frame-ancestors 'none'")) throw new Error(`CSP missing frame-ancestors 'none'`);
    
    const pp = resp.headers.get('permissions-policy');
    if (!pp) throw new Error('Permissions-Policy header missing');
  });

  // ─── 21. Foundation Regression ────────────────────────────────────────────

  await runTest('/api/leads responds correctly (foundation regression)', async () => {
    // GET should return 405 Method Not Allowed
    const resp = await apiFetch('/api/leads', { method: 'GET', noCookie: true });
    if (resp.status === 500) throw new Error('Foundation API returned 500');
    // Expected 405 for GET on leads endpoint
    if (![405, 404].includes(resp.status)) {
      throw new Error(`Unexpected status for GET /api/leads: ${resp.status}`);
    }
  });

  // ─── SUMMARY ──────────────────────────────────────────────────────────────

  console.log(`\n=== E2E Results: ${passCount} passed, ${failCount} failed ===`);
  if (failCount > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Unexpected E2E error:', err);
  process.exit(1);
});
