import { neon } from '@neondatabase/serverless';

// Singleton instance to prevent multiple connections in the same function execution context
let sqlInstance = null;

const PRODUCTION_ENDPOINT_ID = 'ep-square-recipe-avlk7lu1';

function endpointMatchesHostname(hostname, endpointId) {
  return hostname === endpointId ||
    hostname.startsWith(endpointId + '.') ||
    hostname.startsWith(endpointId + '-pooler.');
}

export function validateDatabaseUrl(url, env = process.env) {
  if (!url) {
    throw new Error('Database connection string is missing (DATABASE_URL)');
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error('DATABASE_URL is not a valid URL');
  }

  if (parsedUrl.protocol !== 'postgres:' && parsedUrl.protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL protocol must be postgres');
  }

  const isProd = env.VERCEL_ENV === 'production';
  const isPreview = env.VERCEL_ENV === 'preview';

  if (isProd) {
    if (!endpointMatchesHostname(parsedUrl.hostname, PRODUCTION_ENDPOINT_ID)) {
      throw new Error('DATABASE_URL hostname does not match expected Production endpoint');
    }
    const dbName = decodeURIComponent(parsedUrl.pathname.replace(/^\//, ''));
    if (dbName !== 'neondb') {
      throw new Error('DATABASE_URL database name does not match expected Production database');
    }
  } else if (isPreview) {
    if (endpointMatchesHostname(parsedUrl.hostname, PRODUCTION_ENDPOINT_ID)) {
      throw new Error('DATABASE_URL cannot point to Production endpoint in Preview');
    }
    const expectedEndpoint = env.EXPECTED_NEON_ENDPOINT_ID;

    if (!expectedEndpoint) {
      throw new Error('EXPECTED_NEON_ENDPOINT_ID is required in Preview');
    }
    if (expectedEndpoint === PRODUCTION_ENDPOINT_ID) {
      throw new Error('Expected endpoint cannot be Production in Preview');
    }

    if (!endpointMatchesHostname(parsedUrl.hostname, expectedEndpoint)) {
      throw new Error('DATABASE_URL hostname does not match expected Preview endpoint');
    }

    const dbName = decodeURIComponent(parsedUrl.pathname.replace(/^\//, ''));
    if (dbName !== 'neondb') {
      throw new Error('DATABASE_URL database name does not match expected Preview database (neondb)');
    }
  }

  return parsedUrl;
}

export function resolveDatabaseUrl(env) {
  const isPreview = env.VERCEL_ENV === 'preview';
  const isProd = env.VERCEL_ENV === 'production';

  // Strict enforcement: only DATABASE_URL is valid in cloud
  let dbUrl = env.DATABASE_URL;

  if (!dbUrl && !isPreview && !isProd) {
    dbUrl = env.POSTGRES_URL || env.STORAGE_DATABASE_URL;
  }

  if (!dbUrl) {
    throw new Error('Database connection string is missing (DATABASE_URL)');
  }

  validateDatabaseUrl(dbUrl, env);

  return dbUrl;
}

export function getDb() {
  if (sqlInstance) return sqlInstance;

  const dbUrl = resolveDatabaseUrl(process.env);
  sqlInstance = neon(dbUrl);
  return sqlInstance;
}
