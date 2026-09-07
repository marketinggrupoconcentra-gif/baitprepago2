import { neon } from '@neondatabase/serverless';
const sql = neon('postgresql://neondb_owner:npg_jU1R6uLsrHhT@ep-jolly-bread-avsqkawa-pooler.c-11.us-east-1.aws.neon.tech/neondb?sslmode=require');

async function main() {
  try {
    await sql`CREATE DATABASE baitprepago_duplicates`;
    console.log('CREATED');
  } catch (err) {
    console.error('Error:', err.message);
  }
}
main();
