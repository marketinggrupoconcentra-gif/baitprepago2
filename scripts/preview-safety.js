/**
 * scripts/preview-safety.js
 *
 * Guard canónico: garantiza que ningún entorno de Preview (Vercel) pueda
 * conectarse accidentalmente a la base de datos de Producción (Neon).
 *
 * FAIL CLOSED ante cualquier ambigüedad.
 *
 * Resolución de URL: idéntica a lib/db.js
 *   DATABASE_URL || POSTGRES_URL || STORAGE_DATABASE_URL
 *
 * En Preview, solo se permiten DATABASE_URL o POSTGRES_URL como fuente de
 * conexión. STORAGE_DATABASE_URL puede estar compartido entre scopes (prod y
 * preview), por lo que NO se acepta como fallback en entorno Preview.
 */

'use strict';

// ─── Canonical Production identifiers ───────────────────────────────────────
// Neon project: sweet-mud-87845510
// Production branch: main (primary: true, default: true)
const PRODUCTION_BRANCH_ID   = 'br-lingering-sun-avyoux4u';
const PRODUCTION_ENDPOINT_ID = 'ep-square-recipe-avlk7lu1';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Resolves the effective database URL using the SAME precedence as lib/db.js:
 *   DATABASE_URL || POSTGRES_URL || STORAGE_DATABASE_URL
 *
 * Returns { url, source } where source is the env var name used,
 * or { url: null, source: null } when none is set.
 *
 * NEVER prints the URL value.
 */
function resolveDbUrl(env) {
  if (env.DATABASE_URL)         return { url: env.DATABASE_URL,         source: 'DATABASE_URL' };
  if (env.POSTGRES_URL)         return { url: env.POSTGRES_URL,         source: 'POSTGRES_URL' };
  if (env.STORAGE_DATABASE_URL) return { url: env.STORAGE_DATABASE_URL, source: 'STORAGE_DATABASE_URL' };
  return { url: null, source: null };
}

/**
 * Main guard.
 * Exported so tests can call it with a controlled env object.
 *
 * @param {Record<string,string>} env - process.env or a test-controlled object.
 */
function enforceSafety(env) {
  env = env || process.env;

  const VERCEL_ENV              = env.VERCEL_ENV;
  const EXPECTED_NEON_BRANCH_ID   = env.EXPECTED_NEON_BRANCH_ID;
  const EXPECTED_NEON_ENDPOINT_ID = env.EXPECTED_NEON_ENDPOINT_ID;

  console.log('🛡️  Preview Safety Check (Stage 1H.1 — canonical guards)');

  // ── 1. Script is blocked entirely in Production ───────────────────────────
  if (VERCEL_ENV === 'production') {
    console.error('❌ FAIL CLOSED: VERCEL_ENV=production. Este script está bloqueado en Producción.');
    process.exit(1);
  }

  // ── 2. No VERCEL_ENV → local dev, allow through ───────────────────────────
  if (!VERCEL_ENV) {
    console.warn('⚠️  No VERCEL_ENV detected. Assuming local development mode — skipping cloud checks.');
    return;
  }

  // ── From here on VERCEL_ENV === 'preview' (or an unknown value) ───────────

  // ── 3. Explicit expected identifiers are required ─────────────────────────
  if (!EXPECTED_NEON_BRANCH_ID) {
    console.error('❌ FAIL CLOSED: EXPECTED_NEON_BRANCH_ID is missing. Preview requires an explicit QA branch ID.');
    process.exit(1);
  }
  if (!EXPECTED_NEON_ENDPOINT_ID) {
    console.error('❌ FAIL CLOSED: EXPECTED_NEON_ENDPOINT_ID is missing. Preview requires an explicit QA endpoint ID.');
    process.exit(1);
  }

  // ── 4. Expected identifiers must NOT be Production ────────────────────────
  if (EXPECTED_NEON_BRANCH_ID === PRODUCTION_BRANCH_ID) {
    console.error('❌ FAIL CLOSED: EXPECTED_NEON_BRANCH_ID coincide con la rama de Producción canónica.');
    process.exit(1);
  }
  if (EXPECTED_NEON_ENDPOINT_ID === PRODUCTION_ENDPOINT_ID) {
    console.error('❌ FAIL CLOSED: EXPECTED_NEON_ENDPOINT_ID coincide con el endpoint de Producción canónico.');
    process.exit(1);
  }

  // ── 5. Resolve effective DB URL (mirrors lib/db.js order) ─────────────────
  const { url: effectiveUrl, source: effectiveSource } = resolveDbUrl(env);

  if (!effectiveUrl) {
    console.error('❌ FAIL CLOSED: No hay URL de base de datos configurada (DATABASE_URL / POSTGRES_URL / STORAGE_DATABASE_URL).');
    process.exit(1);
  }

  // ── 6. In Preview, STORAGE_DATABASE_URL must NOT be the effective source ──
  //    It may be shared between Production and Preview scopes in Vercel,
  //    so it cannot be the sole connection source in a Preview deployment.
  if (VERCEL_ENV === 'preview' && effectiveSource === 'STORAGE_DATABASE_URL') {
    console.error(
      '❌ FAIL CLOSED: En entorno Preview, la URL efectiva proviene de STORAGE_DATABASE_URL. ' +
      'Preview debe tener DATABASE_URL o POSTGRES_URL explícito con scope de rama QA. ' +
      'STORAGE_DATABASE_URL puede estar compartido con Producción y NO se acepta como fallback en Preview.'
    );
    process.exit(1);
  }

  // ── 7. Effective URL must contain the expected QA endpoint ────────────────
  if (!effectiveUrl.includes(EXPECTED_NEON_ENDPOINT_ID)) {
    console.error(
      `❌ FAIL CLOSED: La URL efectiva (fuente: ${effectiveSource}) no contiene EXPECTED_NEON_ENDPOINT_ID. ` +
      'La conexión no apunta al endpoint QA declarado.'
    );
    process.exit(1);
  }

  // ── 8. Effective URL must NOT contain the Production endpoint ─────────────
  if (effectiveUrl.includes(PRODUCTION_ENDPOINT_ID)) {
    console.error(
      `❌ FAIL CLOSED: La URL efectiva (fuente: ${effectiveSource}) contiene el PRODUCTION_ENDPOINT_ID canónico. ` +
      'Preview NO puede conectarse al endpoint de Producción.'
    );
    process.exit(1);
  }

  // ── 9. Effective URL must NOT contain the Production branch ID ────────────
  //    Some Neon URL formats embed the branch ID in the hostname.
  if (effectiveUrl.includes(PRODUCTION_BRANCH_ID)) {
    console.error(
      `❌ FAIL CLOSED: La URL efectiva (fuente: ${effectiveSource}) contiene el PRODUCTION_BRANCH_ID canónico. ` +
      'Preview NO puede conectarse a la rama de Producción.'
    );
    process.exit(1);
  }

  // ── 10. Check DUPLICATES_DATABASE_URL if present ──────────────────────────
  const dupUrl = env.DUPLICATES_DATABASE_URL;
  if (VERCEL_ENV === 'preview') {
    if (!dupUrl) {
      console.error('❌ FAIL CLOSED: DUPLICATES_DATABASE_URL missing. Preview requires explicit secondary DB config.');
      process.exit(1);
    }
    
    let parsedUrl;
    try {
      parsedUrl = new URL(dupUrl);
    } catch (err) {
      console.error('❌ FAIL CLOSED: DUPLICATES_DATABASE_URL is not a valid URL.');
      process.exit(1);
    }

    if (parsedUrl.protocol !== 'postgres:' && parsedUrl.protocol !== 'postgresql:') {
      console.error('❌ FAIL CLOSED: DUPLICATES_DATABASE_URL protocol must be postgres.');
      process.exit(1);
    }

    // Must strictly match the endpoint id in hostname
    const expectedDupEndpoint = env.EXPECTED_DUPLICATES_NEON_ENDPOINT_ID || EXPECTED_NEON_ENDPOINT_ID;
    if (!parsedUrl.hostname.startsWith(expectedDupEndpoint + '.')) {
      console.error('❌ FAIL CLOSED: DUPLICATES_DATABASE_URL hostname does not match expected QA endpoint.');
      process.exit(1);
    }

    // Must strictly match the database name
    const expectedDupDbName = env.EXPECTED_DUPLICATES_DATABASE_NAME || 'baitprepago_duplicates';
    const dbName = parsedUrl.pathname.slice(1);
    if (dbName !== expectedDupDbName) {
      console.error('❌ FAIL CLOSED: DUPLICATES_DATABASE_URL database name does not match expected QA database.');
      process.exit(1);
    }

    // Reject query string hacks and username/password trickery
    if (
      parsedUrl.username.includes(PRODUCTION_ENDPOINT_ID) || 
      parsedUrl.password.includes(PRODUCTION_ENDPOINT_ID) || 
      dupUrl.includes(PRODUCTION_ENDPOINT_ID) ||
      dupUrl.includes(PRODUCTION_BRANCH_ID)
    ) {
      console.error(
        `❌ FAIL CLOSED: DUPLICATES_DATABASE_URL contiene identificadores de Producción. ` +
        'Preview NO puede conectarse a Producción para la BDD secundaria.'
      );
      process.exit(1);
    }
  }

  // ── All checks passed ─────────────────────────────────────────────────────
  console.log(`✅ Preview Safety OK`);
  console.log(`   VERCEL_ENV:              ${VERCEL_ENV}`);
  console.log(`   Effective DB source:     ${effectiveSource}`);
  console.log(`   Expected branch:         ${EXPECTED_NEON_BRANCH_ID}`);
  console.log(`   Expected endpoint:       ${EXPECTED_NEON_ENDPOINT_ID}`);
  console.log(`   Production branch match: NO`);
  console.log(`   Production endpoint match: NO`);
  console.log(`   Storage fallback possible: ${effectiveSource === 'STORAGE_DATABASE_URL' ? 'YES ⚠️' : 'NO'}`);
  console.log(`   Duplicates DB URL set:   ${dupUrl ? 'YES' : 'NO ⚠️'}`);
}

// ── Entry point ───────────────────────────────────────────────────────────────
if (require.main === module) {
  enforceSafety(process.env);
} else {
  module.exports = { enforceSafety, resolveDbUrl, PRODUCTION_BRANCH_ID, PRODUCTION_ENDPOINT_ID };
}
