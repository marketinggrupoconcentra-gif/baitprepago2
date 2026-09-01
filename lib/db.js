import { neon } from '@neondatabase/serverless';

// Singleton instance to prevent multiple connections in the same function execution context
let sqlInstance = null;

export function getDb() {
  if (sqlInstance) return sqlInstance;

  // Use standard DATABASE_URL provided by Neon/Vercel integration
  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  
  if (!dbUrl) {
    throw new Error('Database connection string is missing (DATABASE_URL/POSTGRES_URL)');
  }

  sqlInstance = neon(dbUrl);
  return sqlInstance;
}
