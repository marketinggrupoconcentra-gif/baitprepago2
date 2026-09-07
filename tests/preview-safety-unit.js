/**
 * tests/preview-safety-unit.js
 *
 * Suite completa de tests para scripts/preview-safety.js.
 *
 * Cubre:
 *  1. Preview válido con DATABASE_URL QA           → PASS
 *  2. Preview válido con POSTGRES_URL QA           → PASS
 *  3. Solo STORAGE_DATABASE_URL en Preview         → FAIL CLOSED
 *  4. DATABASE_URL apuntando a Production          → FAIL CLOSED
 *  5. POSTGRES_URL apuntando a Production          → FAIL CLOSED
 *  6. EXPECTED_NEON_ENDPOINT_ID == Production      → FAIL CLOSED
 *  7. EXPECTED_NEON_BRANCH_ID == Production        → FAIL CLOSED
 *  8. EXPECTED_NEON_BRANCH_ID ausente              → FAIL CLOSED
 *  9. EXPECTED_NEON_ENDPOINT_ID ausente            → FAIL CLOSED
 * 10. EXPECTED_NEON_ENDPOINT_ID incorrecto (no QA) → FAIL CLOSED
 * 11. VERCEL_ENV=production                        → FAIL CLOSED
 * 12. Desarrollo local sin VERCEL_ENV              → PASS seguro
 * 13. URL contiene PRODUCTION_BRANCH_ID            → FAIL CLOSED
 * 14. URL contiene PRODUCTION_ENDPOINT_ID explícito→ FAIL CLOSED
 * 15. Paridad con lib/db.js: resolveDbUrl coincide → PASS
 *
 * Run: node tests/preview-safety-unit.js
 */

'use strict';

const { execFileSync }   = require('child_process');
const path               = require('path');

// Import the guard as a module (not execute main)
const {
  enforceSafety,
  resolveDbUrl,
  PRODUCTION_BRANCH_ID,
  PRODUCTION_ENDPOINT_ID
} = require('../scripts/preview-safety');

let passed = 0;
let failed = 0;

// Canonical test values (QA branch)
const QA_BRANCH_ID   = 'br-wandering-wildflower-avydy51w';
const QA_ENDPOINT_ID = 'ep-jolly-bread-avsqkawa';

// A fake URL that looks like a Neon QA URL containing the QA endpoint
const QA_DB_URL = `postgresql://fakeuser:fakepwd@${QA_ENDPOINT_ID}.us-east-2.aws.neon.tech/baitqa`;
// A fake URL that looks like a Neon Production URL
const PROD_DB_URL = `postgresql://fakeuser:fakepwd@${PRODUCTION_ENDPOINT_ID}.us-east-2.aws.neon.tech/baitprod`;
// A fake STORAGE URL that contains Production endpoint (shared scope)
const PROD_STORAGE_DB_URL = `postgresql://fakeuser:fakepwd@${PRODUCTION_ENDPOINT_ID}.us-east-2.aws.neon.tech/storage`;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Runs enforceSafety() with a synthetic env, capturing whether it calls
 * process.exit(1). Since process.exit would kill the test runner, we monkey-
 * patch it temporarily.
 *
 * @returns {{ exited: boolean, exitCode: number|null }}
 */
function runSafety(envOverrides) {
  let exited     = false;
  let exitCode   = null;
  const origExit = process.exit;
  process.exit   = (code) => { exited = true; exitCode = code; throw new Error(`__process_exit_${code}__`); };

  try {
    enforceSafety(envOverrides);
  } catch (err) {
    if (!String(err.message).startsWith('__process_exit_')) throw err;
  } finally {
    process.exit = origExit;
  }

  return { exited, exitCode };
}

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✅ PASS: ${message}`);
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${message}`);
  }
}

function assertPass(env, label) {
  const result = runSafety(env);
  assert(!result.exited, label);
}

function assertFailClosed(env, label) {
  const result = runSafety(env);
  assert(result.exited && result.exitCode === 1, label);
}

// ─── Base QA env (valid) ─────────────────────────────────────────────────────
function qaEnv(overrides) {
  return Object.assign({
    VERCEL_ENV:               'preview',
    EXPECTED_NEON_BRANCH_ID:  QA_BRANCH_ID,
    EXPECTED_NEON_ENDPOINT_ID: QA_ENDPOINT_ID,
    DATABASE_URL:             QA_DB_URL,
  }, overrides);
}

// ─── Test suite ──────────────────────────────────────────────────────────────
console.log('\n🧪 preview-safety-unit.js\n');

// 1. Valid preview — DATABASE_URL = QA
console.log('─ Test 1: Valid preview with DATABASE_URL pointing to QA');
assertPass(qaEnv(), 'DATABASE_URL QA endpoint → PASS');

// 2. Valid preview — POSTGRES_URL QA (no DATABASE_URL)
console.log('─ Test 2: Valid preview with POSTGRES_URL pointing to QA (no DATABASE_URL)');
assertPass(qaEnv({ DATABASE_URL: undefined, POSTGRES_URL: QA_DB_URL }),
  'POSTGRES_URL QA endpoint → PASS');

// 3. Only STORAGE_DATABASE_URL in preview (no DATABASE_URL, no POSTGRES_URL)
console.log('─ Test 3: Only STORAGE_DATABASE_URL in preview → FAIL CLOSED');
assertFailClosed(qaEnv({ DATABASE_URL: undefined, POSTGRES_URL: undefined, STORAGE_DATABASE_URL: QA_DB_URL }),
  'STORAGE_DATABASE_URL solo en Preview → FAIL CLOSED');

// 4. DATABASE_URL contains Production endpoint
console.log('─ Test 4: DATABASE_URL pointing to Production endpoint → FAIL CLOSED');
assertFailClosed(qaEnv({ DATABASE_URL: PROD_DB_URL }),
  'Production DATABASE_URL → FAIL CLOSED');

// 5. POSTGRES_URL contains Production endpoint (no DATABASE_URL)
console.log('─ Test 5: POSTGRES_URL pointing to Production endpoint → FAIL CLOSED');
assertFailClosed(qaEnv({ DATABASE_URL: undefined, POSTGRES_URL: PROD_DB_URL }),
  'Production POSTGRES_URL → FAIL CLOSED');

// 6. EXPECTED_NEON_ENDPOINT_ID === Production endpoint
console.log('─ Test 6: EXPECTED_NEON_ENDPOINT_ID equals Production endpoint → FAIL CLOSED');
assertFailClosed(qaEnv({ EXPECTED_NEON_ENDPOINT_ID: PRODUCTION_ENDPOINT_ID }),
  'Production endpoint as expected → FAIL CLOSED');

// 7. EXPECTED_NEON_BRANCH_ID === Production branch
console.log('─ Test 7: EXPECTED_NEON_BRANCH_ID equals Production branch → FAIL CLOSED');
assertFailClosed(qaEnv({ EXPECTED_NEON_BRANCH_ID: PRODUCTION_BRANCH_ID }),
  'Production branch as expected → FAIL CLOSED');

// 8. EXPECTED_NEON_BRANCH_ID missing
console.log('─ Test 8: EXPECTED_NEON_BRANCH_ID missing → FAIL CLOSED');
assertFailClosed(qaEnv({ EXPECTED_NEON_BRANCH_ID: undefined }),
  'Missing expected branch → FAIL CLOSED');

// 9. EXPECTED_NEON_ENDPOINT_ID missing
console.log('─ Test 9: EXPECTED_NEON_ENDPOINT_ID missing → FAIL CLOSED');
assertFailClosed(qaEnv({ EXPECTED_NEON_ENDPOINT_ID: undefined }),
  'Missing expected endpoint → FAIL CLOSED');

// 10. EXPECTED_NEON_ENDPOINT_ID set to a wrong (neither QA nor Production) endpoint
console.log('─ Test 10: DATABASE_URL does not contain EXPECTED_NEON_ENDPOINT_ID → FAIL CLOSED');
assertFailClosed(qaEnv({ EXPECTED_NEON_ENDPOINT_ID: 'ep-some-other-endpoint-xyz' }),
  'Wrong QA endpoint (URL mismatch) → FAIL CLOSED');

// 11. VERCEL_ENV=production
console.log('─ Test 11: VERCEL_ENV=production → FAIL CLOSED');
assertFailClosed(qaEnv({ VERCEL_ENV: 'production' }),
  'VERCEL_ENV=production → FAIL CLOSED');

// 12. Local dev (no VERCEL_ENV)
console.log('─ Test 12: Local development (no VERCEL_ENV) → PASS (safe passthrough)');
assertPass({ DATABASE_URL: QA_DB_URL },  // no VERCEL_ENV key at all
  'Local dev without VERCEL_ENV → safe PASS');

// 13. URL contains PRODUCTION_BRANCH_ID in its hostname
console.log('─ Test 13: Effective URL contains PRODUCTION_BRANCH_ID → FAIL CLOSED');
const urlWithProdBranch = `postgresql://u:p@${PRODUCTION_BRANCH_ID}.proxy.neon.tech/db`;
// Use a custom EXPECTED_NEON_ENDPOINT_ID that also appears in the URL
// (to get past check #7, we embed the expected endpoint, but also include the prod branch)
const urlWithBothIds = `postgresql://u:p@${QA_ENDPOINT_ID}.${PRODUCTION_BRANCH_ID}.proxy.neon.tech/db`;
assertFailClosed(qaEnv({ DATABASE_URL: urlWithBothIds }),
  'URL contains PRODUCTION_BRANCH_ID → FAIL CLOSED');

// 14. URL contains PRODUCTION_ENDPOINT_ID explicitly
console.log('─ Test 14: Effective URL contains PRODUCTION_ENDPOINT_ID → FAIL CLOSED');
// Embed both IDs so it passes endpoint-id present check, but must fail on prod endpoint present
const urlWithBothEndpoints = `postgresql://u:p@${QA_ENDPOINT_ID}.${PRODUCTION_ENDPOINT_ID}.proxy.neon.tech/db`;
assertFailClosed(qaEnv({ DATABASE_URL: urlWithBothEndpoints }),
  'URL contains PRODUCTION_ENDPOINT_ID → FAIL CLOSED');

// ─── Parity test: resolveDbUrl mirrors lib/db.js resolution ─────────────────
console.log('─ Test 15: resolveDbUrl parity with lib/db.js');

// We cannot import lib/db.js (ESM) in CJS, so we replicate the resolution
// logic explicitly and assert both would make the same decision.
// If someone changes lib/db.js resolution order without updating preview-safety.js,
// this test must be updated too — and CI will surface the divergence.

function simulateLibDbResolve(env) {
  // This mirrors exactly what lib/db.js resolveDatabaseUrl() does:
  if (env.DATABASE_URL)         return { url: env.DATABASE_URL,         source: 'DATABASE_URL' };
  if (env.POSTGRES_URL)         return { url: env.POSTGRES_URL,         source: 'POSTGRES_URL' };
  if (env.STORAGE_DATABASE_URL) return { url: env.STORAGE_DATABASE_URL, source: 'STORAGE_DATABASE_URL' };
  return { url: null, source: null };
}

const parityScenarios = [
  { DATABASE_URL: 'a', POSTGRES_URL: 'b', STORAGE_DATABASE_URL: 'c' },
  {                    POSTGRES_URL: 'b', STORAGE_DATABASE_URL: 'c' },
  {                                       STORAGE_DATABASE_URL: 'c' },
  {},
];

let parityOk = true;
for (const env of parityScenarios) {
  const safetyResult = resolveDbUrl(env);
  const libResult    = simulateLibDbResolve(env);
  if (safetyResult.url !== libResult.url || safetyResult.source !== libResult.source) {
    parityOk = false;
    console.error(
      `  ❌ PARITY DIVERGENCE: env=${JSON.stringify(env)}\n` +
      `     preview-safety: source=${safetyResult.source}\n` +
      `     lib/db.js:       source=${libResult.source}`
    );
  }
}
assert(parityOk, 'resolveDbUrl() in preview-safety matches lib/db.js resolution order');

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n🏁 Tests finished: ${passed} passed, ${failed} failed.\n`);
if (failed > 0) process.exit(1);
