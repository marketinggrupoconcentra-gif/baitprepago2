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

  sql = neon(url);

  return sql;
}
