import { neon } from '@neondatabase/serverless';

// Singleton instance to prevent multiple connections in the same function execution context
let sqlInstance = null;

export function resolveDatabaseUrl(env) {
  // Use standard DATABASE_URL provided by Neon/Vercel integration.
  // Precedence: DATABASE_URL > POSTGRES_URL > STORAGE_DATABASE_URL
  //
  // In Preview environments STORAGE_DATABASE_URL may be scoped to Production
  // (Vercel shares it across preview/production by default). Therefore, under
  // VERCEL_ENV==='preview', STORAGE_DATABASE_URL is intentionally excluded as
  // a fallback. Only an explicit branch-scoped DATABASE_URL or POSTGRES_URL
  // is accepted. This matches the enforcement in scripts/preview-safety.js.
  const isPreview = env.VERCEL_ENV === 'preview';

  if (env.DATABASE_URL) return env.DATABASE_URL;
  if (env.POSTGRES_URL) return env.POSTGRES_URL;

  if (!isPreview && env.STORAGE_DATABASE_URL) return env.STORAGE_DATABASE_URL;

  if (isPreview && env.STORAGE_DATABASE_URL) {
    throw new Error(
      'Database connection rejected in Preview: STORAGE_DATABASE_URL is not allowed as a fallback ' +
      'in VERCEL_ENV=preview because it may be shared with the Production scope. ' +
      'Set DATABASE_URL or POSTGRES_URL with an explicit QA branch-scoped connection string.'
    );
  }

  throw new Error('Database connection string is missing (DATABASE_URL/POSTGRES_URL/STORAGE_DATABASE_URL)');
}

export function getDb() {
  if (sqlInstance) return sqlInstance;

  const dbUrl = resolveDatabaseUrl(process.env);
  sqlInstance = neon(dbUrl);
  return sqlInstance;
}
