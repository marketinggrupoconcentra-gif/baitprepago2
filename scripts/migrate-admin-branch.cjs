/**
 * scripts/migrate-admin-branch.cjs
 *
 * Runs admin schema migration against the feat/admin-dashboard Neon branch (ep-sparkling-pond).
 * Fail-closed: only runs against ep-sparkling-pond endpoint.
 *
 * Usage: DATABASE_URL="postgresql://..." node scripts/migrate-admin-branch.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ALLOWED_ENDPOINT = 'ep-sparkling-pond';
const PRODUCTION_ENDPOINT = 'a57hzmzw';

function failClose(reason) {
  console.error(`\n⛔ FAIL CLOSED: ${reason}`);
  process.exit(1);
}

const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
if (!dbUrl) failClose('DATABASE_URL not set');
if (!dbUrl.includes(ALLOWED_ENDPOINT)) failClose(`Expected ${ALLOWED_ENDPOINT} endpoint — got: ${dbUrl.slice(0, 60)}`);
if (dbUrl.includes(PRODUCTION_ENDPOINT)) failClose('Production endpoint detected');

console.log('=== Admin Migration (feat/admin-dashboard Neon branch) ===');
console.log(`Target endpoint: ${ALLOWED_ENDPOINT}\n`);

/**
 * Splits SQL DDL into individual statements, respecting parentheses nesting
 */
function splitSqlStatements(sql) {
  const statements = [];
  let current = '';
  let depth = 0;
  let inLineComment = false;
  let inBlockComment = false;
  let i = 0;

  while (i < sql.length) {
    const char = sql[i];
    const next = sql[i + 1] || '';

    if (!inBlockComment && !inLineComment && char === '-' && next === '-') {
      inLineComment = true; current += char; i++; continue;
    }
    if (inLineComment && char === '\n') {
      inLineComment = false; current += char; i++; continue;
    }
    if (!inLineComment && !inBlockComment && char === '/' && next === '*') {
      inBlockComment = true; current += char; i++; continue;
    }
    if (inBlockComment && char === '*' && next === '/') {
      inBlockComment = false; current += '*/'; i += 2; continue;
    }
    if (!inLineComment && !inBlockComment) {
      if (char === '(') depth++;
      if (char === ')') depth--;
      if (char === ';' && depth === 0) {
        const stmt = current.trim();
        if (stmt.length > 0) statements.push(stmt);
        current = ''; i++; continue;
      }
    }
    current += char; i++;
  }
  const stmt = current.trim();
  if (stmt.length > 0) statements.push(stmt);
  return statements.filter(s => s.replace(/--[^\n]*/g, '').trim().length > 0);
}

async function run() {
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(dbUrl);

  const migrationPath = path.join(__dirname, '..', 'db', 'migrations', '002_admin_auth.sql');
  console.log('Reading migration:', migrationPath);
  const ddl = fs.readFileSync(migrationPath, 'utf8');

  const statements = splitSqlStatements(ddl);
  console.log(`Executing ${statements.length} DDL statements...\n`);

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const preview = stmt.substring(0, 65).replace(/\s+/g, ' ');
    process.stdout.write(`  [${i + 1}/${statements.length}] ${preview}... `);
    try {
      await sql.query(stmt);
      console.log('OK');
    } catch (err) {
      console.log('FAIL');
      console.error('    Error:', err.message);
      process.exit(1);
    }
  }

  console.log('\n✅ Admin schema applied to ep-sparkling-pond branch.\n');

  // Verify
  const tables = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`;
  console.log('Tables:', tables.map(t => t.table_name).join(', '));
  process.exit(0);
}

run().catch(e => { console.error(e.message); process.exit(1); });
