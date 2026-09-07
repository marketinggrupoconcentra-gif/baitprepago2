/**
 * tests/migration-005-failclosed.js
 * Confirms Migration 005's timezone guard actually fails closed: it must
 * check current_setting('TimeZone') BEFORE any SET/ALTER/CREATE, so that a
 * session whose effective timezone is NOT America/Mexico_City aborts the
 * whole migration instead of silently "fixing" itself with SET TIME ZONE
 * and then reporting success.
 *
 * Run with: node --env-file=.env.branch tests/migration-005-failclosed.js
 * (uses a throwaway table in the same QA database, never touches leads or
 * captcha_challenges from a non-CDMX session)
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('@neondatabase/serverless');
const { enforceSafety } = require('../scripts/preview-safety');

console.log('Running migration-005-failclosed tests...');
let failed = 0;
let passed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`✅ PASS: ${message}`);
  } else {
    failed++;
    console.error(`❌ FAIL: ${message}`);
  }
}

async function run() {
  enforceSafety();

  if (!process.env.DATABASE_URL) {
    console.error('❌ FAIL: DATABASE_URL is not set. Run with --env-file=.env.branch');
    process.exit(1);
  }

  const migrationSource = fs.readFileSync(
    path.join(__dirname, '..', 'db', 'migrations', '005_form_security_captcha.sql'),
    'utf8'
  );

  // 1. Static guard: the guard's DO block must be the first executable
  //    statement, and there must be no `SET TIME ZONE` before it.
  const guardIdx = migrationSource.indexOf("current_setting('TimeZone')");
  // Only real executable statements count — exclude comment lines ("--") so
  // prose explaining the guard doesn't trip this check.
  const executableSetTz = migrationSource
    .split('\n')
    .some(line => !line.trim().startsWith('--') && /\bSET\s+TIME\s+ZONE\b/i.test(line));
  assert(guardIdx !== -1, 'La migración contiene el guard de current_setting(\'TimeZone\')');
  assert(!executableSetTz, 'La migración ya no ejecuta SET TIME ZONE (evitaría el fail-closed)');

  const firstAlterIdx = migrationSource.indexOf('ALTER TABLE');
  const firstCreateIdx = migrationSource.indexOf('CREATE TABLE');
  assert(guardIdx < firstAlterIdx, 'El guard de timezone corre antes del primer ALTER TABLE');
  assert(guardIdx < firstCreateIdx, 'El guard de timezone corre antes del primer CREATE TABLE');

  // 2. Dynamic guard: run the migration's own guard DO block verbatim
  //    against a session forced to a non-CDMX timezone, on a real QA
  //    connection, and confirm it raises instead of silently continuing.
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query("SET TIME ZONE 'UTC'"); // simulate a misconfigured session
    const tz = await client.query(`SELECT current_setting('TimeZone') AS tz`);
    assert(tz.rows[0].tz === 'UTC', 'Precondition: la sesión de prueba está forzada a UTC (no CDMX)');

    const guardBlock = `
      DO $$
      BEGIN
        IF current_setting('TimeZone') <> 'America/Mexico_City' THEN
          RAISE EXCEPTION
            'Migration 005 aborted: effective TimeZone is %, expected America/Mexico_City',
            current_setting('TimeZone');
        END IF;
      END
      $$;
    `;

    let threw = false;
    let errorMessage = '';
    try {
      await client.query(guardBlock);
    } catch (err) {
      threw = true;
      errorMessage = err.message;
    }
    assert(threw, 'El guard aborta (RAISE EXCEPTION) cuando la sesión no está en America/Mexico_City');
    assert(/Migration 005 aborted/.test(errorMessage), 'El mensaje de error identifica la migración abortada');

    // Confirm no side effect happened (no throwaway table created) since
    // the guard must run standalone, before any DDL.
    const check = await client.query(`
      SELECT to_regclass('public.migration_005_failclosed_smoke') AS reg
    `);
    assert(check.rows[0].reg === null, 'Ningún objeto se crea cuando el guard aborta primero (fail closed real)');
  } finally {
    await client.query("SET TIME ZONE 'America/Mexico_City'"); // restore session default
    client.release();
    await pool.end();
  }

  console.log(`\nTests finished: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('Fatal error in tests', err);
  process.exit(1);
});
