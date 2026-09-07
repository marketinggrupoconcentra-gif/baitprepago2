import { neon } from '@neondatabase/serverless';

let sql;

export function getDuplicatesDb() {
  if (sql) {
    return sql;
  }

  const url = process.env.DUPLICATES_DATABASE_URL;
  if (!url) {
    throw new Error('DUPLICATES_DATABASE_URL is not set');
  }

  // FAIL CLOSED validations in preview environment
  if (process.env.VERCEL_ENV === 'preview') {
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch (err) {
      throw new Error('DUPLICATES_DATABASE_URL is not a valid URL');
    }

    if (parsedUrl.protocol !== 'postgres:' && parsedUrl.protocol !== 'postgresql:') {
      throw new Error('DUPLICATES_DATABASE_URL protocol must be postgres');
    }

    const expectedEndpoint = process.env.EXPECTED_DUPLICATES_NEON_ENDPOINT_ID || 'ep-jolly-bread-avsqkawa';
    const expectedDbName = process.env.EXPECTED_DUPLICATES_DATABASE_NAME || 'baitprepago_duplicates';

    // Must strictly match the endpoint id in hostname
    if (!parsedUrl.hostname.startsWith(expectedEndpoint + '.')) {
      if (parsedUrl.hostname.includes('ep-square-recipe-avlk7lu1')) {
        throw new Error('DUPLICATES_DATABASE_URL cannot point to Production endpoint');
      }
      throw new Error('DUPLICATES_DATABASE_URL hostname does not match expected QA endpoint');
    }

    // Must strictly match the database name
    const dbName = parsedUrl.pathname.slice(1);
    if (dbName !== expectedDbName) {
      if (dbName === 'neondb') {
        throw new Error('DUPLICATES_DATABASE_URL cannot use neondb as database name');
      }
      throw new Error('DUPLICATES_DATABASE_URL database name does not match expected QA database');
    }

    // Reject query string hacks and username/password trickery
    if (parsedUrl.username.includes('ep-square-recipe-avlk7lu1') || parsedUrl.password.includes('ep-square-recipe-avlk7lu1') || url.includes('ep-square-recipe-avlk7lu1')) {
       throw new Error('DUPLICATES_DATABASE_URL contains Production identifiers in credentials or query');
    }
  }

  sql = neon(url);
  return sql;
}
