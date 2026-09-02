'use strict';
/**
 * EPHEMERAL AUTHENTICATED SMOKE TEST — Production
 * Reads email and password from stdin.
 * Performs login, verifies cookies, tests overview API, verifies PII absence,
 * performs logout, checks DB state.
 */
const https = require('https');
const readline = require('readline');
const { neon } = require('@neondatabase/serverless');

const PROD_HOST = 'baitprepago2.vercel.app';
const DB_URL = process.env.DATABASE_URL;

function failClose(msg) { console.error(`\n⛔ FAIL: ${msg}`); process.exit(1); }

async function request(method, path, bodyObj = null, cookie = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: PROD_HOST,
      port: 443,
      path: path,
      method: method,
      headers: {
        'Origin': `https://${PROD_HOST}`,
        'Host': PROD_HOST,
        'User-Agent': 'Node-Smoke-Test'
      }
    };
    if (cookie) options.headers['Cookie'] = cookie;
    let bodyStr = '';
    if (bodyObj) {
      bodyStr = JSON.stringify(bodyObj);
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: data
        });
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function readLines(count) {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  const lines = [];
  return new Promise(resolve => {
    rl.on('line', line => {
      lines.push(line.trim());
      if (lines.length >= count) { rl.close(); resolve(lines); }
    });
    rl.on('close', () => resolve(lines));
  });
}

async function main() {
  if (!DB_URL) failClose('DATABASE_URL not set');
  const sql = neon(DB_URL);

  console.log('Reading credentials from stdin...');
  const lines = await readLines(2);
  const email = lines[0];
  const password = lines[1];
  if (!email || !password) failClose('Missing credentials');

  console.log(`\n=== 1. LOGIN PRODUCTION ===`);
  const loginRes = await request('POST', '/api/admin/login', { email, password });
  console.log(`POST /api/admin/login -> ${loginRes.status}`);
  if (loginRes.status !== 200) failClose(`Login failed: ${loginRes.data}`);

  const setCookie = loginRes.headers['set-cookie'] || [];
  const sessionCookieStr = setCookie.find(c => c.startsWith('bait_admin_session='));
  if (!sessionCookieStr) failClose('No bait_admin_session cookie received');

  console.log(`\n=== 2. COOKIE SECURITY ===`);
  if (sessionCookieStr.includes('HttpOnly')) console.log('✅ HttpOnly present');
  else failClose('HttpOnly missing');
  if (sessionCookieStr.includes('Secure')) console.log('✅ Secure present');
  else failClose('Secure missing');
  if (sessionCookieStr.includes('SameSite=Strict')) console.log('✅ SameSite=Strict present');
  else failClose('SameSite=Strict missing');
  if (sessionCookieStr.includes('Path=/')) console.log('✅ Path=/ present');
  else failClose('Path=/ missing');

  const cookieVal = sessionCookieStr.split(';')[0]; // bait_admin_session=...

  console.log(`\n=== 3. DASHBOARD / SESSION ===`);
  const sessionRes = await request('GET', '/api/admin/session', null, cookieVal);
  console.log(`GET /api/admin/session -> ${sessionRes.status}`);
  if (sessionRes.status !== 200) failClose('Session verification failed');

  console.log(`\n=== 4. OVERVIEW API ===`);
  for (const r of [7, 14, 30]) {
    const ov = await request('GET', `/api/admin/overview?range=${r}`, null, cookieVal);
    console.log(`GET /api/admin/overview?range=${r} -> ${ov.status}`);
    if (ov.status !== 200) failClose(`Overview range ${r} failed`);
    
    const data = JSON.parse(ov.data);
    if (r === 7) {
      console.log(`\n=== 5. VALIDAR DATOS REALES ===`);
      const [{ n }] = await sql`SELECT count(*)::int as n FROM leads`;
      console.log(`DB leads count: ${n}`);
      console.log(`Overview total: ${data.kpis.total}`);
      if (n !== data.kpis.total) failClose('Overview total does not match DB leads count');
      
      console.log(`\n=== 6. PRIVACY PRODUCTION ===`);
      const dataStr = JSON.stringify(data).toLowerCase();
      const pii = ['phone', 'ip', 'nip', 'phoneconfirm', 'fbclid', 'page_url', 'user_agent'];
      let leak = false;
      for (const p of pii) {
        if (dataStr.includes(`"${p}"`) || dataStr.includes(`'${p}'`)) {
          console.error(`❌ LEAK DETECTED: ${p}`);
          leak = true;
        }
      }
      if (leak) failClose('PII leaked in overview');
      console.log('✅ No PII in overview');
    }
  }

  console.log(`\n=== 7. LOGOUT ===`);
  const logoutRes = await request('POST', '/api/admin/logout', null, cookieVal);
  console.log(`POST /api/admin/logout -> ${logoutRes.status}`);
  if (logoutRes.status !== 200) failClose('Logout failed');

  const logoutCookie = (logoutRes.headers['set-cookie'] || []).find(c => c.startsWith('bait_admin_session='));
  if (!logoutCookie || !logoutCookie.includes('Expires=Thu, 01 Jan 1970 00:00:00 GMT')) {
    failClose('Cookie not cleared on logout');
  } else {
    console.log('✅ Cookie cleared');
  }

  const sessionResAfter = await request('GET', '/api/admin/session', null, cookieVal);
  console.log(`GET /api/admin/session after logout -> ${sessionResAfter.status}`);
  if (sessionResAfter.status !== 401) failClose('Session still active after logout');

  console.log(`\n=== 8. AUDIT & DB STATE ===`);
  const [users] = await sql`SELECT count(*)::int as n FROM admin_users`;
  const [sessions] = await sql`SELECT count(*)::int as n FROM admin_sessions`;
  const [attempts] = await sql`SELECT count(*)::int as n FROM admin_login_attempts`;
  console.log(`admin_users: ${users.n} (expected 1)`);
  console.log(`admin_sessions: ${sessions.n} (expected 0)`);
  console.log(`admin_login_attempts: ${attempts.n} (expected 0)`);

  const auditRows = await sql`SELECT action, actor_hash, metadata FROM admin_audit_log ORDER BY created_at DESC LIMIT 5`;
  const actions = auditRows.map(r => r.action);
  console.log(`Audit actions found: ${actions.join(', ')}`);
  if (!actions.includes('LOGIN_SUCCESS')) failClose('LOGIN_SUCCESS missing from audit');
  if (!actions.includes('LOGOUT')) failClose('LOGOUT missing from audit');

  let auditLeak = false;
  const auditStr = JSON.stringify(auditRows).toLowerCase();
  if (auditStr.includes(password.toLowerCase())) { console.error('❌ Password leaked in audit!'); auditLeak = true; }
  if (auditStr.includes('bait_admin_session')) { console.error('❌ Session token leaked in audit!'); auditLeak = true; }
  if (auditStr.includes('postgresql://')) { console.error('❌ DB URL leaked in audit!'); auditLeak = true; }
  // We can't strictly check raw IP as we don't know it, but we know we only store hashed IPs
  if (auditLeak) failClose('Sensitive data leaked in audit log');
  console.log('✅ Audit logs clean');

  console.log('\n✅ AUTHENTICATED SMOKE TEST PASS');
  process.exit(0);
}

main().catch(e => { console.error(e.stack); process.exit(1); });
