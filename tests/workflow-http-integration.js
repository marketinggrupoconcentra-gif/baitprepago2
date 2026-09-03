// tests/workflow-http-integration.js
const assert = require('assert');
const { resolveDatabaseUrl } = require('../lib/db.js');
const { neon } = require('@neondatabase/serverless');

const REQUIRED_ENVS = [
  'VERCEL_PREVIEW_URL',
  'VERCEL_AUTOMATION_BYPASS_SECRET',
  'QA_ADMIN_EMAIL',
  'QA_ADMIN_PASSWORD',
  'QA_VIEWER_EMAIL',
  'QA_VIEWER_PASSWORD'
];

for (const env of REQUIRED_ENVS) {
  if (!process.env[env]) {
    console.error(`❌ Required environment variable missing: ${env}`);
    process.exit(1);
  }
}

const BASE_URL = process.env.VERCEL_PREVIEW_URL.replace(/\/$/, '');
const BYPASS_SECRET = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

async function doFetch(path, options = {}) {
  const headers = {
    'x-vercel-protection-bypass': BYPASS_SECRET,
    'origin': BASE_URL,
    ...options.headers
  };
  if (options.session) {
    headers['Cookie'] = `bait_admin_session=${options.session}`;
  }
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, { ...options, headers });
  return res;
}

async function login(email, password) {
  const res = await doFetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  if (res.status !== 200) {
    throw new Error(`Failed to login with ${email}: ${res.status}`);
  }
  const setCookie = res.headers.get('set-cookie');
  const match = setCookie && setCookie.match(/bait_admin_session=([^;]+)/);
  if (!match) throw new Error('No session cookie returned');
  return match[1];
}

async function runTests() {
  const dbUrl = resolveDatabaseUrl(process.env);
  const sql = neon(dbUrl);
  
  const RUN_ID = 'HTTP_TEST_' + Date.now();

  let adminSession;
  let viewerSession;
  let testIds = [];

  try {
    console.log('--- STARTING WORKFLOW HTTP INTEGRATION TESTS ---');

    console.log('[+] 0. Safe Identity Handshake...');
    const handshakeInsert = await sql`
      INSERT INTO leads (
        phone, utm_source, status, status_version
      ) VALUES (
        '1111111111', ${RUN_ID}, 'NEW', 1
      ) RETURNING id
    `;
    const handshakeId = handshakeInsert[0].id;
    testIds.push(handshakeId);
    
    adminSession = await login(process.env.QA_ADMIN_EMAIL, process.env.QA_ADMIN_PASSWORD);
    
    const handshakeFetch = await doFetch(`/api/admin/leads/detail?id=${handshakeId}`, { session: adminSession });
    if (handshakeFetch.status === 404) {
      throw new Error('Handshake failed: API returned 404 for DB-inserted lead. API is pointing to a different DB!');
    }
    assert(handshakeFetch.status === 200, 'Handshake fetch should be 200');
    console.log('    Handshake OK. Remote API hits local DB connection.');

    console.log('[+] 1. Logging in QA VIEWER...');
    viewerSession = await login(process.env.QA_VIEWER_EMAIL, process.env.QA_VIEWER_PASSWORD);

    console.log('[+] 2. Testing Workflow Config HTTP...');
    let res = await doFetch('/api/admin/leads/workflow');
    assert(res.status === 401, 'Unauth should be 401');

    res = await doFetch('/api/admin/leads/workflow', { session: adminSession });
    assert(res.status === 200, 'SUPER_ADMIN should be 200');
    let data = await res.json();
    assert(data.canManageStatus === true, 'SUPER_ADMIN can manage status');
    assert(Array.isArray(data.statuses), 'Missing status catalog');

    res = await doFetch('/api/admin/leads/workflow', { session: viewerSession });
    assert(res.status === 200, 'VIEWER should be 200');
    data = await res.json();
    assert(data.canManageStatus === false, 'VIEWER cannot manage status');

    console.log('[+] 3. Testing Status HTTP Security Matrix...');
    // VIEWER attempt -> 403
    res = await doFetch('/api/admin/leads/status', { method: 'PATCH', session: viewerSession, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: handshakeId, status: 'CONTACTED', expectedVersion: 1 }) });
    assert(res.status === 403, 'VIEWER should be 403');
    
    // WRONG METHOD -> 405
    res = await doFetch('/api/admin/leads/status', { method: 'POST', session: adminSession });
    assert(res.status === 405, 'Wrong method should be 405');
    
    // NO CONTENT TYPE -> 415
    res = await doFetch('/api/admin/leads/status', { method: 'PATCH', session: adminSession, body: JSON.stringify({ id: handshakeId, status: 'CONTACTED', expectedVersion: 1 }) });
    assert(res.status === 415, 'No JSON Content-Type should be 415');

    // MISSING BODY -> 400
    res = await doFetch('/api/admin/leads/status', { method: 'PATCH', session: adminSession, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    assert(res.status === 400, 'Missing fields should be 400');

    console.log('[+] 4. Testing Concurrency Stress (20x pairs)...');
    
    for(let i=0; i<20; i++) {
      const insertRes = await sql`
        INSERT INTO leads (
          phone, utm_source, status, status_version
        ) VALUES (
          '5555555555', ${RUN_ID}, 'NEW', 1
        ) RETURNING id
      `;
      testIds.push(insertRes[0].id);
    }

    // Skip handshake ID for concurrency test
    const concurrencyIds = testIds.slice(1);
    
    let expected200 = 0;
    let expected409 = 0;
    let doubleSuccess = 0;

    for (const leadId of concurrencyIds) {
      const p1 = doFetch('/api/admin/leads/status', {
        method: 'PATCH',
        session: adminSession,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: leadId, status: 'CONTACTED', expectedVersion: 1 })
      });
      const p2 = doFetch('/api/admin/leads/status', {
        method: 'PATCH',
        session: adminSession,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: leadId, status: 'VALIDATED', expectedVersion: 1 })
      });

      const [r1, r2] = await Promise.all([p1, p2]);
      const s1 = r1.status;
      const s2 = r2.status;

      if (s1 === 200) expected200++;
      if (s2 === 200) expected200++;
      if (s1 === 409) expected409++;
      if (s2 === 409) expected409++;
      if (s1 === 200 && s2 === 200) doubleSuccess++;

      const dbLead = await sql`SELECT status, status_version FROM leads WHERE id = ${leadId}`;
      assert(dbLead[0].status_version === 2, `Expected version 2, got ${dbLead[0].status_version}`);
      
      const audits = await sql`SELECT COUNT(*) as c FROM lead_audit_logs WHERE lead_id = ${leadId.toString()}`;
      assert(parseInt(audits[0].c, 10) === 1, `Expected exactly 1 audit row for lead ${leadId}, got ${audits[0].c}`);
    }

    console.log(`    Expected 200: 20 (Actual: ${expected200})`);
    console.log(`    Expected 409: 20 (Actual: ${expected409})`);
    assert(expected200 === 20, 'Should have exactly 20 successful CAS updates');
    assert(expected409 === 20, 'Should have exactly 20 CAS losses');
    assert(doubleSuccess === 0, 'Should have ZERO double success');

    // Test NOOP
    console.log('[+] 5. Testing SAME STATUS NOOP...');
    const noopId = concurrencyIds[0];
    const noopLead = await sql`SELECT status, status_version FROM leads WHERE id = ${noopId}`;
    res = await doFetch('/api/admin/leads/status', {
      method: 'PATCH',
      session: adminSession,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: noopId, status: noopLead[0].status, expectedVersion: noopLead[0].status_version })
    });
    assert(res.status === 200, 'NOOP should return 200');
    data = await res.json();
    assert(data.changed === false, 'NOOP should have changed = false');
    const auditCheck = await sql`SELECT COUNT(*) as c FROM lead_audit_logs WHERE lead_id = ${noopId.toString()}`;
    assert(parseInt(auditCheck[0].c, 10) === 1, 'NOOP should NOT create a new audit record (remains 1)');

    // Test Reason change (NOT a NOOP)
    console.log('[+] 6. Testing SAME STATUS DIFFERENT REASON...');
    const reasonId = concurrencyIds[1];
    await doFetch('/api/admin/leads/status', {
      method: 'PATCH',
      session: adminSession,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: reasonId, status: 'REJECTED', reason: 'INVALID_DATA', expectedVersion: 2 })
    });
    res = await doFetch('/api/admin/leads/status', {
      method: 'PATCH',
      session: adminSession,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: reasonId, status: 'REJECTED', reason: 'DUPLICATE', expectedVersion: 3 })
    });
    assert(res.status === 200, 'Same status reason change should return 200');
    data = await res.json();
    assert(data.changed === true, 'Reason change should have changed = true');
    assert(data.lead.statusVersion === 4, 'Version should increment');

    console.log('[+] 7. Testing Audit Log PII Masking...');
    const auditPIICheck = await sql`SELECT action_metadata FROM lead_audit_logs WHERE lead_id = ${reasonId} AND new_status = 'REJECTED' LIMIT 1`;
    const metadata = auditPIICheck[0].action_metadata;
    assert(!metadata.phone, 'Audit log should NOT contain raw phone');
    assert(!metadata.phoneConfirm, 'Audit log should NOT contain phoneConfirm');
    assert(!metadata.nip, 'Audit log should NOT contain nip');

    console.log('--- HTTP INTEGRATION TESTS PASSED ---');
  } catch (err) {
    console.error('--- TEST FAILED ---');
    console.error(err);
    process.exit(1);
  } finally {
    console.log('[+] Cleaning up RUN_ID:', RUN_ID);
    if (RUN_ID) {
      await sql`DELETE FROM admin_audit_log WHERE metadata->>'leadId' IN (SELECT id::text FROM leads WHERE utm_source = ${RUN_ID})`;
      await sql`DELETE FROM leads WHERE utm_source = ${RUN_ID}`;
    }
  }
}

runTests();
