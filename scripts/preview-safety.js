/**
 * scripts/preview-safety.js
 *
 * Guard canónico para impedir que Preview use infraestructura de Producción.
 * FAIL CLOSED ante cualquier ambigüedad.
 */

'use strict';

const PRODUCTION_BRANCH_ID   = 'br-lingering-sun-avyoux4u';
const PRODUCTION_ENDPOINT_ID = 'ep-square-recipe-avlk7lu1';

function resolveDbUrl(env) {
  if (env.DATABASE_URL)         return { url: env.DATABASE_URL,         source: 'DATABASE_URL' };
  if (env.POSTGRES_URL)         return { url: env.POSTGRES_URL,         source: 'POSTGRES_URL' };
  if (env.STORAGE_DATABASE_URL) return { url: env.STORAGE_DATABASE_URL, source: 'STORAGE_DATABASE_URL' };
  return { url: null, source: null };
}

function endpointMatchesHostname(hostname, endpointId) {
  return hostname === endpointId ||
    hostname.startsWith(endpointId + '.') ||
    hostname.startsWith(endpointId + '-pooler.');
}

function parsePostgresUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    console.error(`❌ FAIL CLOSED: ${label} no es una URL válida.`);
    process.exit(1);
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    console.error(`❌ FAIL CLOSED: ${label} debe usar protocolo postgres/postgresql.`);
    process.exit(1);
  }
  return parsed;
}

function enforceSafety(env) {
  env = env || process.env;

  const VERCEL_ENV = env.VERCEL_ENV;
  const EXPECTED_NEON_BRANCH_ID = env.EXPECTED_NEON_BRANCH_ID;
  const EXPECTED_NEON_ENDPOINT_ID = env.EXPECTED_NEON_ENDPOINT_ID;

  console.log('🛡️  Preview Safety Check');

  if (VERCEL_ENV === 'production') {
    console.error('❌ FAIL CLOSED: este guard no puede ejecutarse como operación Preview sobre Production.');
    process.exit(1);
  }

  if (!VERCEL_ENV) {
    console.warn('⚠️  Sin VERCEL_ENV: modo local; no se ejecutan checks cloud de Preview.');
    return;
  }

  if (VERCEL_ENV !== 'preview') {
    console.error(`❌ FAIL CLOSED: VERCEL_ENV inesperado: ${VERCEL_ENV}`);
    process.exit(1);
  }

  if (!EXPECTED_NEON_BRANCH_ID || !EXPECTED_NEON_ENDPOINT_ID) {
    console.error('❌ FAIL CLOSED: faltan identificadores esperados de Neon para Preview.');
    process.exit(1);
  }

  if (EXPECTED_NEON_BRANCH_ID === PRODUCTION_BRANCH_ID || EXPECTED_NEON_ENDPOINT_ID === PRODUCTION_ENDPOINT_ID) {
    console.error('❌ FAIL CLOSED: los identificadores esperados coinciden con Producción.');
    process.exit(1);
  }

  const { url: effectiveUrl, source: effectiveSource } = resolveDbUrl(env);
  if (!effectiveUrl) {
    console.error('❌ FAIL CLOSED: no hay URL efectiva de base principal.');
    process.exit(1);
  }
  if (effectiveSource === 'STORAGE_DATABASE_URL') {
    console.error('❌ FAIL CLOSED: STORAGE_DATABASE_URL no puede ser el fallback efectivo en Preview.');
    process.exit(1);
  }

  const primaryUrl = parsePostgresUrl(effectiveUrl, effectiveSource);
  if (!endpointMatchesHostname(primaryUrl.hostname, EXPECTED_NEON_ENDPOINT_ID)) {
    console.error('❌ FAIL CLOSED: la base principal no coincide con el endpoint Preview esperado.');
    process.exit(1);
  }
  if (endpointMatchesHostname(primaryUrl.hostname, PRODUCTION_ENDPOINT_ID)) {
    console.error('❌ FAIL CLOSED: la base principal apunta a Production.');
    process.exit(1);
  }
  if (effectiveUrl.includes(PRODUCTION_BRANCH_ID)) {
    console.error('❌ FAIL CLOSED: la URL principal contiene el branch ID de Production.');
    process.exit(1);
  }

  const dupUrlValue = env.DUPLICATES_DATABASE_URL;
  const expectedDupEndpoint = env.EXPECTED_DUPLICATES_NEON_ENDPOINT_ID;
  const expectedDupDbName = env.EXPECTED_DUPLICATES_DATABASE_NAME;

  if (!dupUrlValue || !expectedDupEndpoint || !expectedDupDbName) {
    console.error('❌ FAIL CLOSED: faltan DUPLICATES_DATABASE_URL o sus identificadores esperados.');
    process.exit(1);
  }
  if (expectedDupEndpoint === PRODUCTION_ENDPOINT_ID) {
    console.error('❌ FAIL CLOSED: el endpoint esperado de duplicados coincide con Production.');
    process.exit(1);
  }

  const dupUrl = parsePostgresUrl(dupUrlValue, 'DUPLICATES_DATABASE_URL');
  if (!endpointMatchesHostname(dupUrl.hostname, expectedDupEndpoint)) {
    console.error('❌ FAIL CLOSED: la BDD secundaria no coincide con el endpoint Preview esperado.');
    process.exit(1);
  }
  if (endpointMatchesHostname(dupUrl.hostname, PRODUCTION_ENDPOINT_ID)) {
    console.error('❌ FAIL CLOSED: la BDD secundaria apunta a Production.');
    process.exit(1);
  }

  const duplicateDbName = decodeURIComponent(dupUrl.pathname.replace(/^\//, ''));
  if (duplicateDbName !== expectedDupDbName) {
    console.error('❌ FAIL CLOSED: el nombre de la BDD secundaria no coincide con el esperado.');
    process.exit(1);
  }
  if (dupUrlValue.includes(PRODUCTION_BRANCH_ID)) {
    console.error('❌ FAIL CLOSED: la URL secundaria contiene el branch ID de Production.');
    process.exit(1);
  }

  console.log('✅ Preview Safety OK');
  console.log(`   VERCEL_ENV: ${VERCEL_ENV}`);
  console.log(`   Effective DB source: ${effectiveSource}`);
  console.log(`   Expected branch configured: YES`);
  console.log(`   Expected primary endpoint configured: YES`);
  console.log(`   Expected duplicates endpoint configured: YES`);
  console.log(`   Expected duplicates database configured: YES`);
}

if (require.main === module) {
  enforceSafety(process.env);
} else {
  module.exports = {
    enforceSafety,
    resolveDbUrl,
    endpointMatchesHostname,
    PRODUCTION_BRANCH_ID,
    PRODUCTION_ENDPOINT_ID
  };
}
