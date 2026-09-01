/**
 * scripts/cleanup-qa.js
 * Single-use QA cleanup — deletes qa-admin@bait.invalid and related rows.
 */
require('./preview-safety.js');

const EXPECTED_ENDPOINT = 'ep-little-darkness';
const QA_EMAIL = 'qa-admin@bait.invalid';

async function cleanup() {
  const dbUrl = process.env.DATABASE_URL || '';
  if (!dbUrl.includes(EXPECTED_ENDPOINT) || dbUrl.includes('a57hzmzw')) {
    console.error('FAIL CLOSED: Wrong endpoint.'); process.exit(1);
  }
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(dbUrl);

  const userRows = await sql`SELECT id FROM admin_users WHERE email = ${QA_EMAIL}`;
  if (userRows.length === 0) { console.log('QA user not found — already clean.'); process.exit(0); }
  const userId = userRows[0].id;

  const s = await sql`DELETE FROM admin_sessions WHERE admin_user_id = ${userId} RETURNING id`;
  const a = await sql`DELETE FROM admin_audit_log WHERE admin_user_id = ${userId} RETURNING id`;
  const l = await sql`DELETE FROM admin_login_attempts WHERE 1=1 RETURNING id`;
  const u = await sql`DELETE FROM admin_users WHERE id = ${userId} RETURNING id`;

  console.log('Cleanup done:', { sessions: s.length, audit: a.length, attempts: l.length, users: u.length });
  console.log('✅ QA data removed from Preview DB.');
  process.exit(0);
}

cleanup().catch(e => { console.error(e.message); process.exit(1); });
