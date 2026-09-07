import fs from 'fs';
import { neon } from '@neondatabase/serverless';

const sql = neon('postgresql://neondb_owner:npg_jU1R6uLsrHhT@ep-jolly-bread-avsqkawa-pooler.c-11.us-east-1.aws.neon.tech/baitprepago_duplicates?sslmode=require');

async function main() {
  try {
    const migration = fs.readFileSync('db/duplicates/migrations/001_duplicate_leads.sql', 'utf8');
    const statements = migration.split(';').filter(s => s.trim().length > 0);
    for (const stmt of statements) {
      await sql.query(stmt + ';');
    }
    console.log('MIGRATION APPLIED');
  } catch (err) {
    console.error('Error:', err.message);
  }
}
main();
