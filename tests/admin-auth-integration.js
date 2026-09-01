/**
 * tests/admin-auth-integration.js
 * 
 * Integration tests against the Neon Preview database (br-dark-frost-a54t4r79).
 * FAIL CLOSED: Aborts if DATABASE_URL does not point to the expected preview endpoint.
 * 
 * Run with:
 *   node --env-file=.env.branch tests/admin-auth-integration.js
 */

import { neon } from '@neondatabase/serverless';

const EXPECTED_ENDPOINT = 'ep-little-darkness';
const EXPECTED_BRANCH_ID = 'br-dark-frost-a54t4r79';

const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';

if (!dbUrl) {
  console.error('❌ DATABASE_URL not set. Aborting.');
  process.exit(1);
}

if (!dbUrl.includes(EXPECTED_ENDPOINT)) {
  console.error(`❌ FAIL CLOSED: DATABASE_URL does not reference expected endpoint (${EXPECTED_ENDPOINT}).`);
  console.error(`   This test must only run against preview-admin-auth (${EXPECTED_BRANCH_ID}).`);
  process.exit(1);
}

const sql = neon(dbUrl);

let passCount = 0;
let failCount = 0;

async function runTest(name, fn) {
  try {
    await fn();
    console.log(`✅ PASS: ${name}`);
    passCount++;
  } catch (e) {
    console.error(`❌ FAIL: ${name} — ${e.message || e}`);
    failCount++;
  }
}

async function runTests() {
  console.log('=== Admin Auth Integration Tests ===');
  console.log(`Target endpoint: ${EXPECTED_ENDPOINT}`);
  console.log(`Expected branch: ${EXPECTED_BRANCH_ID}\n`);

  // ─── Schema Existence ─────────────────────────────────────────────────────────

  await runTest('admin_users table exists', async () => {
    const res = await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'admin_users'
    `;
    if (res.length !== 1) throw new Error('admin_users table not found');
  });

  await runTest('admin_sessions table exists', async () => {
    const res = await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'admin_sessions'
    `;
    if (res.length !== 1) throw new Error('admin_sessions table not found');
  });

  await runTest('admin_login_attempts table exists', async () => {
    const res = await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'admin_login_attempts'
    `;
    if (res.length !== 1) throw new Error('admin_login_attempts table not found');
  });

  await runTest('admin_audit_log table exists', async () => {
    const res = await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'admin_audit_log'
    `;
    if (res.length !== 1) throw new Error('admin_audit_log table not found');
  });

  // ─── Constraint Verification ─────────────────────────────────────────────────

  await runTest('admin_login_attempts has UNIQUE(kind,key_hash) constraint', async () => {
    const res = await sql`
      SELECT constraint_name
      FROM information_schema.table_constraints
      WHERE table_schema = 'public'
        AND table_name = 'admin_login_attempts'
        AND constraint_type = 'UNIQUE'
        AND constraint_name = 'admin_login_attempts_kind_key_hash_unique'
    `;
    if (res.length !== 1) throw new Error('UNIQUE(kind,key_hash) constraint missing');
  });

  await runTest('admin_login_attempts has kind CHECK constraint', async () => {
    const res = await sql`
      SELECT constraint_name
      FROM information_schema.table_constraints
      WHERE table_schema = 'public'
        AND table_name = 'admin_login_attempts'
        AND constraint_type = 'CHECK'
        AND constraint_name = 'admin_login_attempts_kind_check'
    `;
    if (res.length !== 1) throw new Error('kind CHECK constraint missing');
  });

  await runTest('admin_users has role CHECK constraint', async () => {
    const res = await sql`
      SELECT constraint_name
      FROM information_schema.table_constraints
      WHERE table_schema = 'public'
        AND table_name = 'admin_users'
        AND constraint_type = 'CHECK'
        AND constraint_name = 'admin_users_role_check'
    `;
    if (res.length !== 1) throw new Error('role CHECK constraint missing');
  });

  // ─── Referential Integrity ────────────────────────────────────────────────────

  await runTest('admin_sessions has FK to admin_users', async () => {
    const res = await sql`
      SELECT constraint_name
      FROM information_schema.table_constraints
      WHERE table_schema = 'public'
        AND table_name = 'admin_sessions'
        AND constraint_type = 'FOREIGN KEY'
    `;
    if (res.length === 0) throw new Error('admin_sessions FK to admin_users missing');
  });

  await runTest('admin_audit_log has FK to admin_users (nullable)', async () => {
    const res = await sql`
      SELECT constraint_name
      FROM information_schema.table_constraints
      WHERE table_schema = 'public'
        AND table_name = 'admin_audit_log'
        AND constraint_type = 'FOREIGN KEY'
    `;
    if (res.length === 0) throw new Error('admin_audit_log FK missing');
  });

  // ─── Role Constraint Enforcement ─────────────────────────────────────────────

  await runTest('admin_users rejects invalid role', async () => {
    let threw = false;
    try {
      await sql`
        INSERT INTO admin_users (email, password_hash, role)
        VALUES ('test-invalid-role@bait.invalid', 'scrypt$dummy', 'INVALID_ROLE')
      `;
    } catch (_e) {
      threw = true;
    }
    if (!threw) throw new Error('Expected constraint violation for invalid role, got none');
    // Clean up any partial insert
    await sql`DELETE FROM admin_users WHERE email = 'test-invalid-role@bait.invalid'`;
  });

  // ─── Kind Constraint Enforcement ─────────────────────────────────────────────

  await runTest('admin_login_attempts rejects invalid kind', async () => {
    let threw = false;
    try {
      await sql`
        INSERT INTO admin_login_attempts (key_hash, kind)
        VALUES ('deadbeef00001111222233334444555566667777888899990000aaaabbbbcccc', 'INVALID_KIND')
      `;
    } catch (_e) {
      threw = true;
    }
    if (!threw) throw new Error('Expected constraint violation for invalid kind, got none');
    await sql`DELETE FROM admin_login_attempts WHERE kind = 'INVALID_KIND'`;
  });

  // ─── UNIQUE(kind,key_hash) enforcement ───────────────────────────────────────

  await runTest('ON CONFLICT (kind, key_hash) upsert works correctly', async () => {
    const testHash = 'aabbccddee' + '00'.repeat(27); // 64 hex chars
    
    // Insert first
    await sql`
      INSERT INTO admin_login_attempts (key_hash, kind, attempts, window_started_at, last_attempt_at)
      VALUES (${testHash}, 'IP', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (kind, key_hash) DO UPDATE
      SET attempts = admin_login_attempts.attempts + 1,
          last_attempt_at = CURRENT_TIMESTAMP
    `;
    
    // Insert second (should upsert)
    await sql`
      INSERT INTO admin_login_attempts (key_hash, kind, attempts, window_started_at, last_attempt_at)
      VALUES (${testHash}, 'IP', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (kind, key_hash) DO UPDATE
      SET attempts = admin_login_attempts.attempts + 1,
          last_attempt_at = CURRENT_TIMESTAMP
    `;
    
    const res = await sql`
      SELECT attempts FROM admin_login_attempts
      WHERE key_hash = ${testHash} AND kind = 'IP'
    `;
    if (res.length !== 1) throw new Error('Expected exactly 1 row after upsert');
    if (res[0].attempts !== 2) throw new Error(`Expected attempts=2, got ${res[0].attempts}`);
    
    // Cleanup
    await sql`DELETE FROM admin_login_attempts WHERE key_hash = ${testHash}`;
  });

  // ─── neon_auth Isolation ──────────────────────────────────────────────────────

  await runTest('neon_auth schema is present but Stage 1A tables are in public schema only', async () => {
    // This confirms we haven't written anything to neon_auth
    const adminInNeonAuth = await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'neon_auth'
        AND table_name IN ('admin_users','admin_sessions','admin_login_attempts','admin_audit_log')
    `;
    if (adminInNeonAuth.length > 0) {
      throw new Error(`admin_* tables found in neon_auth schema! Isolation violated.`);
    }
  });

  // ─── Session Hash Storage ─────────────────────────────────────────────────────

  await runTest('admin_sessions token_hash column exists and has UNIQUE constraint', async () => {
    const cols = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'admin_sessions' AND column_name = 'token_hash'
    `;
    if (cols.length !== 1) throw new Error('token_hash column missing');
    
    const unique = await sql`
      SELECT tc.constraint_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
      WHERE tc.table_schema = 'public'
        AND tc.table_name = 'admin_sessions'
        AND tc.constraint_type = 'UNIQUE'
        AND kcu.column_name = 'token_hash'
    `;
    if (unique.length === 0) throw new Error('token_hash UNIQUE constraint missing');
  });

  // ─── Production Negative Gate ─────────────────────────────────────────────────
  // Note: This check verifies the current Preview DB is NOT Production by checking
  // that the endpoint string matches our expected preview endpoint (already done above).

  await runTest('Database connection uses preview endpoint (not production)', async () => {
    if (!dbUrl.includes(EXPECTED_ENDPOINT)) {
      throw new Error(`Connected to wrong endpoint. Expected ${EXPECTED_ENDPOINT}.`);
    }
    if (dbUrl.includes('a57hzmzw')) {
      throw new Error('DATABASE_URL references Production Neon branch! HALT.');
    }
  });

  // ─── Summary ─────────────────────────────────────────────────────────────────

  console.log(`\n=== Integration Results: ${passCount} passed, ${failCount} failed ===`);
  if (failCount > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
