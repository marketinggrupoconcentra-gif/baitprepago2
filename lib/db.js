import { neon } from '@neondatabase/serverless';

// Singleton instance to prevent multiple connections in the same function execution context
let sqlInstance = null;

export function resolveDatabaseUrl(env) {
  // Use standard DATABASE_URL provided by Neon/Vercel integration
  const dbUrl = env.DATABASE_URL || env.POSTGRES_URL || env.STORAGE_DATABASE_URL;
  if (!dbUrl) {
    throw new Error('Database connection string is missing (DATABASE_URL/POSTGRES_URL/STORAGE_DATABASE_URL)');
  }
  return dbUrl;
}

export function getDb() {
  if (sqlInstance) return sqlInstance;

  const dbUrl = resolveDatabaseUrl(process.env);
  sqlInstance = neon(dbUrl);
  return sqlInstance;
}
