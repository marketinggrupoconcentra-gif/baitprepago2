/**
 * scripts/migrate-admin-branch.js
 *
 * Runs admin schema migration against the feat/admin-dashboard Neon branch (ep-sparkling-pond).
 * Uses the Neon serverless WebSocket driver which supports DDL properly.
 *
 * Usage: DATABASE_URL="postgresql://..." node scripts/migrate-admin-branch.js
 */
import { readFileSync } from 'fs';
import { neonConfig, Pool } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

const ALLOWED_ENDPOINT = 'ep-sparkling-pond';
const PRODUCTION_ENDPOINT = 'a57hzmzw';

function failClose(reason) {
  console.error(`\n⛔ FAIL CLOSED: ${reason}`);
  process.exit(1);
}

const dbUrl = process.env.DATABASE_URL || '';
if (!dbUrl) failClose('DATABASE_URL not set');
if (!dbUrl.includes(ALLOWED_ENDPOINT)) failClose(`Expected ${ALLOWED_ENDPOINT} endpoint — got: ${dbUrl.slice(0, 60)}`);
if (dbUrl.includes(PRODUCTION_ENDPOINT)) failClose('Production endpoint detected');

console.log('=== Admin Migration (feat/admin-dashboard Neon branch) ===');
console.log(`Target endpoint: ${ALLOWED_ENDPOINT}\n`);

const pool = new Pool({ connectionString: dbUrl });

// Read the migration SQL
const migrationSql = readFileSync('db/migrations/002_admin_auth.sql', 'utf8').trim();

const client = await pool.connect();
try {
  await client.query('BEGIN');
  // Strip comment-only lines, then split by semicolons
  const strippedSql = migrationSql
    .split('\n')
    .filter(line => !line.trim().startsWith('--'))
    .join('\n');

  const statements = strippedSql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);

  console.log(`Executing ${statements.length} SQL statements in transaction...`);
  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i] + ';';
    console.log(`  [${i+1}/${statements.length}] ${stmt.substring(0, 55).replace(/\n/g, ' ')}...`);
    await client.query(stmt);
  }
  await client.query('COMMIT');
  console.log('\n✅ Transaction committed.');
} catch (e) {
  await client.query('ROLLBACK');
  console.error('❌ Migration failed, rolled back:', e.message);
  process.exit(1);
} finally {
  client.release();
  await pool.end();
}

// Verify with a simple neon() check
import { neon } from '@neondatabase/serverless';
const sql = neon(dbUrl);
const tables = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`;
console.log('Tables:', tables.map(t=>t.table_name).join(', '));

process.exit(0);
