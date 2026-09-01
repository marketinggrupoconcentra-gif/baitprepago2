/**
 * Quick script to check DB endpoint and tables
 */
import { neon } from '@neondatabase/serverless';

const dbUrl = process.env.DATABASE_URL || '';
console.log('DB URL prefix:', dbUrl.substring(0, 60));
console.log('Endpoint segment:', dbUrl.match(/@([^.]+)\./)?.[1] || 'not found');

const sql = neon(dbUrl);
const r = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`;
console.log('Tables:', r.map(x=>x.table_name).join(', '));
process.exit(0);
