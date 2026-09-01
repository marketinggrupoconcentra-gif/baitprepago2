/**
 * scripts/migrate-admin.js
 * 
 * Applies db/migrations/002_admin_auth.sql to the Admin Preview branch ONLY.
 * 
 * Expected Neon Identity:
 *   Project:  solitary-meadow-63069248
 *   Branch:   preview-admin-auth (br-dark-frost-a54t4r79)
 *   Endpoint: ep-little-darkness-* (compute, not branch ID)
 * 
 * FAIL CLOSED: aborts if DATABASE_URL does not resolve to the expected endpoint prefix.
 */

require('./preview-safety.js');

const fs = require('fs');
const path = require('path');

/**
 * Splits SQL DDL into individual statements, respecting:
 * - Semicolons inside parentheses (constraint definitions) 
 * - Single-line comments (--)
 * - Multi-line comments (/* *\/)
 */
function splitSqlStatements(sql) {
  const statements = [];
  let current = '';
  let depth = 0; // parenthesis depth
  let inLineComment = false;
  let inBlockComment = false;
  let i = 0;

  while (i < sql.length) {
    const char = sql[i];
    const next = sql[i + 1] || '';

    // Handle line comment start
    if (!inBlockComment && !inLineComment && char === '-' && next === '-') {
      inLineComment = true;
      current += char;
      i++;
      continue;
    }

    // End line comment
    if (inLineComment && char === '\n') {
      inLineComment = false;
      current += char;
      i++;
      continue;
    }

    // Handle block comment start
    if (!inLineComment && !inBlockComment && char === '/' && next === '*') {
      inBlockComment = true;
      current += char;
      i++;
      continue;
    }

    // End block comment
    if (inBlockComment && char === '*' && next === '/') {
      inBlockComment = false;
      current += '*/';
      i += 2;
      continue;
    }

    // Track parenthesis depth (not in comments)
    if (!inLineComment && !inBlockComment) {
      if (char === '(') depth++;
      if (char === ')') depth--;

      // Split on ';' only at depth 0 (not inside constraint definitions)
      if (char === ';' && depth === 0) {
        const stmt = current.trim();
        if (stmt.length > 0 && !stmt.match(/^(--.*)$/)) {
          statements.push(stmt);
        }
        current = '';
        i++;
        continue;
      }
    }

    current += char;
    i++;
  }

  // Capture any trailing statement without semicolon
  const stmt = current.trim();
  if (stmt.length > 0) {
    statements.push(stmt);
  }

  return statements.filter(s => {
    // Remove pure comment blocks
    const stripped = s.replace(/--[^\n]*/g, '').trim();
    return stripped.length > 0;
  });
}

async function migrateAdmin() {
  console.log('=== Admin Migration ===');
  console.log('Expected Neon project: solitary-meadow-63069248');
  console.log('Expected branch: preview-admin-auth (br-dark-frost-a54t4r79)');
  console.log('Expected endpoint prefix: ep-little-darkness');

  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';

  if (!dbUrl) {
    console.error('MIGRATION ABORTED: DATABASE_URL is not set.');
    process.exit(1);
  }

  // Endpoint check as secondary safety
  if (!dbUrl.includes('ep-little-darkness')) {
    console.error('MIGRATION ABORTED: DATABASE_URL does not match expected preview endpoint (ep-little-darkness).');
    console.error('This migration must only run against preview-admin-auth (br-dark-frost-a54t4r79).');
    process.exit(1);
  }

  console.log('✅ Endpoint check passed (ep-little-darkness found in URL).');

  // Dynamically import the ESM neon driver
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(dbUrl);

  const migrationPath = path.join(__dirname, '..', 'db', 'migrations', '002_admin_auth.sql');
  console.log('Reading migration:', migrationPath);
  const ddl = fs.readFileSync(migrationPath, 'utf8');

  const statements = splitSqlStatements(ddl);
  console.log(`Executing ${statements.length} DDL statements...`);

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const preview = stmt.substring(0, 70).replace(/\s+/g, ' ').replace(/\n/g, ' ');
    process.stdout.write(`  [${i + 1}/${statements.length}] ${preview}... `);
    
    try {
      // neon() HTTP driver: sql.query(string) accepts a raw string with no template
      await sql.query(stmt);
      console.log('OK');
    } catch (err) {
      console.log('FAIL');
      console.error('    Error:', err.message);
      console.error('    Statement was:', stmt.substring(0, 200));
      process.exit(1);
    }
  }

  console.log('\n✅ Admin Migration applied successfully on Preview (br-dark-frost-a54t4r79).');
  process.exit(0);
}

migrateAdmin().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
