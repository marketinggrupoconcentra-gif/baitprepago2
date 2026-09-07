import { neon } from '@neondatabase/serverless';

let sql;

const PRODUCTION_ENDPOINT_ID = 'ep-square-recipe-avlk7lu1';

function endpointMatchesHostname(hostname, endpointId) {
  return hostname === endpointId ||
    hostname.startsWith(endpointId + '.') ||
    hostname.startsWith(endpointId + '-pooler.');
}

export function validateDuplicatesDatabaseUrl(url, env = process.env) {
  if (!url) {
    throw new Error('DUPLICATES_DATABASE_URL is not set');
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error('DUPLICATES_DATABASE_URL is not a valid URL');
  }

  if (parsedUrl.protocol !== 'postgres:' && parsedUrl.protocol !== 'postgresql:') {
    throw new Error('DUPLICATES_DATABASE_URL protocol must be postgres');
  }

  const isProd = env.VERCEL_ENV === 'production';
  const isPreview = env.VERCEL_ENV === 'preview';

  if (isProd) {
    if (!endpointMatchesHostname(parsedUrl.hostname, PRODUCTION_ENDPOINT_ID)) {
      throw new Error('DUPLICATES_DATABASE_URL hostname does not match expected Production endpoint');
    }
    const dbName = decodeURIComponent(parsedUrl.pathname.replace(/^\//, ''));
    if (dbName !== 'baitprepago_duplicates') {
      throw new Error('DUPLICATES_DATABASE_URL database name does not match expected Production database');
    }
  } else if (isPreview) {
    if (endpointMatchesHostname(parsedUrl.hostname, PRODUCTION_ENDPOINT_ID)) {
      throw new Error('DUPLICATES_DATABASE_URL cannot point to Production endpoint in Preview');
    }
    const expectedEndpoint = env.EXPECTED_DUPLICATES_NEON_ENDPOINT_ID;
    const expectedDbName = env.EXPECTED_DUPLICATES_DATABASE_NAME;

    if (!expectedEndpoint) {
      throw new Error('EXPECTED_DUPLICATES_NEON_ENDPOINT_ID is required in Preview');
    }
    if (!expectedDbName) {
      throw new Error('EXPECTED_DUPLICATES_DATABASE_NAME is required in Preview');
    }
    if (expectedEndpoint === PRODUCTION_ENDPOINT_ID) {
      throw new Error('Expected duplicates endpoint cannot be Production in Preview');
    }

    if (!endpointMatchesHostname(parsedUrl.hostname, expectedEndpoint)) {
      throw new Error('DUPLICATES_DATABASE_URL hostname does not match expected Preview endpoint');
    }

    const dbName = decodeURIComponent(parsedUrl.pathname.replace(/^\//, ''));
    if (dbName !== expectedDbName) {
      throw new Error('DUPLICATES_DATABASE_URL database name does not match expected Preview database');
    }
  }

  return parsedUrl;
}

export function getDuplicatesDb() {
  if (sql) return sql;

  const url = process.env.DUPLICATES_DATABASE_URL;
  validateDuplicatesDatabaseUrl(url, process.env);
  sql = neon(url);
  return sql;
}
