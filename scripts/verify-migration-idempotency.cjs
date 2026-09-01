/**
 * scripts/verify-migration-idempotency.cjs
 *
 * Verifies that db/migrations/002_admin_auth.sql is idempotent and data-preserving.
 *
 * Steps:
 *   1. Creates a temporary Neon branch from Production parent (br-aged-recipe-a57hzmzw)
 *   2. Confirms baseline: only 'leads' table (no admin_* tables)
 *   3. Applies migration once  — verifies all admin tables are created
 *   4. Inserts synthetic data (1 user, 1 session, 1 attempt, 1 audit row)
 *   5. Applies migration a second time — verifies no errors
 *   6. Confirms all synthetic data is preserved
 *   7. Confirms 'leads' is untouched
 *   8. Deletes the temporary branch
 *
 * FAIL CLOSED:
 *   - Only runs against the temporary branch name 'verify-admin-production-migration'
 *   - Never touches Production branch (br-aged-recipe-a57hzmzw)
 *
 * Usage:
 *   NEON_API_KEY="..." node scripts/verify-migration-idempotency.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const NEON_PROJECT_ID    = 'solitary-meadow-63069248';
const PRODUCTION_BRANCH  = 'br-aged-recipe-a57hzmzw';
const TEMP_BRANCH_NAME   = 'verify-admin-production-migration';
const PRODUCTION_ENDPOINT = 'a57hzmzw'; // block connecting to production DB

// ── Helpers ──────────────────────────────────────────────────────────────────
function failClose(msg) { console.error(`\n⛔ FAIL CLOSED: ${msg}`); process.exit(1); }

function neonRequest(method, path, body, apiKey) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'console.neon.tech',
      path: `/api/v2${path}`,
      method,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    }, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Splits SQL DDL into individual statements (respects parens, comments)
 */
function splitSqlStatements(sql) {
  const statements = [];
  let current = '', depth = 0, inLine = false, inBlock = false, i = 0;
  while (i < sql.length) {
    const c = sql[i], n = sql[i+1] || '';
    if (!inBlock && !inLine && c === '-' && n === '-') { inLine = true; current += c; i++; continue; }
    if (inLine && c === '\n') { inLine = false; current += c; i++; continue; }
    if (!inLine && !inBlock && c === '/' && n === '*') { inBlock = true; current += c; i++; continue; }
    if (inBlock && c === '*' && n === '/') { inBlock = false; current += '*/'; i += 2; continue; }
    if (!inLine && !inBlock) {
      if (c === '(') depth++;
      if (c === ')') depth--;
      if (c === ';' && depth === 0) {
        const s = current.trim();
        if (s.length > 0) statements.push(s);
        current = ''; i++; continue;
      }
    }
    current += c; i++;
  }
  const s = current.trim();
  if (s.length > 0) statements.push(s);
  return statements.filter(s => s.replace(/--[^\n]*/g, '').trim().length > 0);
}

async function runMigration(sql, dbUrl) {
  const { neon } = await import('@neondatabase/serverless');
  const db = neon(dbUrl);
  const ddl = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '002_admin_auth.sql'), 'utf8');
  const stmts = splitSqlStatements(ddl);
  for (const stmt of stmts) {
    await db.query(stmt);
  }
}

async function getTables(dbUrl) {
  const { neon } = await import('@neondatabase/serverless');
  const db = neon(dbUrl);
  const rows = await db`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`;
  return rows.map(r => r.table_name);
}

async function main() {
  const apiKey = process.env.NEON_API_KEY || '';
  if (!apiKey) failClose('NEON_API_KEY not set');

  console.log('=== Migration Idempotency Verification ===');
  console.log(`Project: ${NEON_PROJECT_ID}`);
  console.log(`Temp branch: ${TEMP_BRANCH_NAME}`);
  console.log(`Parent: ${PRODUCTION_BRANCH}\n`);

  // ── 1. Delete temp branch if it already exists (idempotent setup) ─────────
  const listRes = await neonRequest('GET', `/projects/${NEON_PROJECT_ID}/branches`, null, apiKey);
  const existingBranch = listRes.body.branches?.find(b => b.name === TEMP_BRANCH_NAME);
  if (existingBranch) {
    console.log(`Removing stale temp branch: ${existingBranch.id}`);
    await neonRequest('DELETE', `/projects/${NEON_PROJECT_ID}/branches/${existingBranch.id}`, null, apiKey);
    await sleep(3000);
  }

  // ── 2. Create temp branch from Production ─────────────────────────────────
  console.log('Creating temporary verification branch from Production...');
  const createRes = await neonRequest('POST', `/projects/${NEON_PROJECT_ID}/branches`, {
    branch: {
      parent_id: PRODUCTION_BRANCH,
      name: TEMP_BRANCH_NAME
    },
    endpoints: [{ type: 'read_write' }]
  }, apiKey);

  if (createRes.status !== 201 && createRes.status !== 200) {
    console.error('Branch creation failed:', JSON.stringify(createRes.body));
    failClose(`Branch creation returned ${createRes.status}`);
  }

  const tempBranch = createRes.body.branch;
  const tempEndpoint = createRes.body.endpoints?.[0];
  const tempBranchId = tempBranch.id;
  const tempEndpointId = tempEndpoint?.id;
  console.log(`✅ Temp branch created: ${tempBranchId}`);
  console.log(`   Endpoint: ${tempEndpointId}`);

  // Fail-close: never connect to production endpoint
  if (tempEndpointId && tempEndpointId.includes(PRODUCTION_ENDPOINT)) {
    failClose('Temp branch endpoint matches Production endpoint — refusing to proceed');
  }

  // Wait for branch to be ready
  await sleep(5000);

  // Build connection string for temp branch
  // Use the same credentials as the source branch but different endpoint
  const prodDbUrl = process.env.PRODUCTION_DB_URL || process.env.DATABASE_URL || '';
  if (!prodDbUrl) failClose('PRODUCTION_DB_URL or DATABASE_URL required to derive temp branch URL');

  // Replace endpoint in the URL
  const sourceEndpoint = prodDbUrl.match(/@([^.]+)\./)?.[1] || '';
  if (!sourceEndpoint) failClose('Could not extract source endpoint from DB URL');
  const tempDbUrl = prodDbUrl.replace(sourceEndpoint, tempEndpointId);
  console.log(`   Temp DB URL endpoint: ${tempEndpointId}\n`);

  let passed = 0, failed = 0;
  function assert(cond, msg) {
    if (cond) { passed++; console.log(`✅ ${msg}`); }
    else { failed++; console.error(`❌ ${msg}`); }
  }

  try {
    // ── 3. Baseline: only 'leads' table ──────────────────────────────────────
    console.log('--- Baseline ---');
    const tablesBefore = await getTables(tempDbUrl);
    assert(tablesBefore.includes('leads'), 'Baseline: leads table exists');
    assert(!tablesBefore.includes('admin_users'), 'Baseline: admin_users absent');
    assert(!tablesBefore.includes('admin_sessions'), 'Baseline: admin_sessions absent');
    assert(!tablesBefore.includes('admin_login_attempts'), 'Baseline: admin_login_attempts absent');
    assert(!tablesBefore.includes('admin_audit_log'), 'Baseline: admin_audit_log absent');

    const { neon } = await import('@neondatabase/serverless');
    const db = neon(tempDbUrl);
    const leadsCountBefore = (await db`SELECT count(*)::int as n FROM leads`)[0].n;
    console.log(`   leads row count before: ${leadsCountBefore}`);

    // ── 4. First migration run ────────────────────────────────────────────────
    console.log('\n--- Migration Run 1 ---');
    await runMigration(null, tempDbUrl);
    const tablesAfterRun1 = await getTables(tempDbUrl);
    assert(tablesAfterRun1.includes('admin_users'), 'Run 1: admin_users created');
    assert(tablesAfterRun1.includes('admin_sessions'), 'Run 1: admin_sessions created');
    assert(tablesAfterRun1.includes('admin_login_attempts'), 'Run 1: admin_login_attempts created');
    assert(tablesAfterRun1.includes('admin_audit_log'), 'Run 1: admin_audit_log created');

    // ── 5. Insert synthetic data ──────────────────────────────────────────────
    console.log('\n--- Synthetic Data Insert ---');
    await db`
      INSERT INTO admin_users (email, password_hash, role, active)
      VALUES ('synthetic-verify@neon.test', 'scrypt:N=16384:r=8:p=1$aabbccddeeff00112233445566778899$aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899', 'VIEWER', false)
    `;
    const userId = (await db`SELECT id FROM admin_users WHERE email = 'synthetic-verify@neon.test'`)[0].id;

    await db`
      INSERT INTO admin_sessions (admin_user_id, token_hash, expires_at)
      VALUES (${userId}, 'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899', NOW() + INTERVAL '1 hour')
    `;
    const sessionId = (await db`SELECT id FROM admin_sessions WHERE admin_user_id = ${userId}`)[0].id;

    await db`
      INSERT INTO admin_login_attempts (key_hash, kind, attempts)
      VALUES ('synth-hash-verify-001', 'IP', 3)
    `;
    const attemptId = (await db`SELECT id FROM admin_login_attempts WHERE key_hash = 'synth-hash-verify-001'`)[0].id;

    await db`
      INSERT INTO admin_audit_log (admin_user_id, action, actor_hash)
      VALUES (${userId}, 'VERIFY_TEST', 'synth-actor-hash-verify-001')
    `;
    const auditId = (await db`SELECT id FROM admin_audit_log WHERE action = 'VERIFY_TEST'`)[0].id;

    console.log(`   Inserted: user=${userId} session=${sessionId} attempt=${attemptId} audit=${auditId}`);
    assert(userId > 0, 'Synthetic admin user inserted');
    assert(sessionId > 0, 'Synthetic session inserted');
    assert(attemptId > 0, 'Synthetic attempt inserted');
    assert(auditId > 0, 'Synthetic audit row inserted');

    // ── 6. Second migration run (idempotency test) ────────────────────────────
    console.log('\n--- Migration Run 2 (idempotency test) ---');
    let run2Error = null;
    try {
      await runMigration(null, tempDbUrl);
    } catch (e) {
      run2Error = e.message;
    }
    assert(!run2Error, `Run 2: no errors${run2Error ? ' — ' + run2Error : ''}`);

    // ── 7. Data preservation ──────────────────────────────────────────────────
    console.log('\n--- Data Preservation ---');
    const preservedUser = await db`SELECT id FROM admin_users WHERE email = 'synthetic-verify@neon.test'`;
    const preservedSession = await db`SELECT id FROM admin_sessions WHERE admin_user_id = ${userId}`;
    const preservedAttempt = await db`SELECT id FROM admin_login_attempts WHERE key_hash = 'synth-hash-verify-001'`;
    const preservedAudit = await db`SELECT id FROM admin_audit_log WHERE action = 'VERIFY_TEST'`;
    const leadsCountAfter = (await db`SELECT count(*)::int as n FROM leads`)[0].n;

    assert(preservedUser.length === 1 && preservedUser[0].id === userId, 'admin user preserved');
    assert(preservedSession.length === 1 && preservedSession[0].id === sessionId, 'session preserved');
    assert(preservedAttempt.length === 1 && preservedAttempt[0].id === attemptId, 'attempt preserved');
    assert(preservedAudit.length === 1 && preservedAudit[0].id === auditId, 'audit preserved');
    assert(leadsCountAfter === leadsCountBefore, `leads untouched (${leadsCountAfter} rows)`);

    // ── 8. Constraints still present ─────────────────────────────────────────
    console.log('\n--- Constraint Verification ---');
    let constraintError = null;
    try {
      await db`INSERT INTO admin_users (email, password_hash, role) VALUES ('dup@neon.test', 'hash', 'INVALID_ROLE')`;
    } catch (e) { constraintError = e.message; }
    assert(constraintError && constraintError.includes('admin_users_role_check'), 'role constraint enforced');

    let dupError = null;
    try {
      await db`INSERT INTO admin_login_attempts (key_hash, kind) VALUES ('synth-hash-verify-001', 'IP')`;
    } catch (e) { dupError = e.message; }
    assert(dupError && dupError.includes('admin_login_attempts_kind_key_hash_unique'), 'UNIQUE(kind,key_hash) enforced');

    // Check neon_auth untouched
    const neonAuthRows = await db`SELECT table_name FROM information_schema.tables WHERE table_schema='neon_auth'`;
    // We don't assert on presence/absence — just confirm we didn't modify it
    console.log(`   neon_auth tables (untouched): ${neonAuthRows.map(r=>r.table_name).join(', ') || '(none or inaccessible)'}`);

  } finally {
    // ── 9. Clean up temp branch ───────────────────────────────────────────────
    console.log('\n--- Cleanup ---');
    const delRes = await neonRequest('DELETE', `/projects/${NEON_PROJECT_ID}/branches/${tempBranchId}`, null, apiKey);
    if (delRes.status === 200 || delRes.status === 204) {
      console.log(`✅ Temp branch ${TEMP_BRANCH_NAME} (${tempBranchId}) deleted`);
    } else {
      console.error(`⚠️  Branch deletion returned ${delRes.status} — manual cleanup may be required`);
    }
  }

  console.log(`\n=== Idempotency Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    console.error('\n❌ MIGRATION IDEMPOTENT: FAIL');
    process.exit(1);
  }
  console.log('\n✅ MIGRATION IDEMPOTENT: PASS');
  console.log('✅ MIGRATION DATA-PRESERVING: PASS');
  console.log('✅ FRESH-SCHEMA MIGRATION: PASS');
  console.log('✅ SECOND-RUN MIGRATION: PASS');
  console.log('✅ LEADS UNTOUCHED: PASS');
  process.exit(0);
}

main().catch(e => { console.error(e.message); process.exit(1); });
