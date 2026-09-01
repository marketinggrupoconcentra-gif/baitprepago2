/**
 * scripts/create-admin-branch.cjs
 *
 * Creates QA admin user on the feat/admin-dashboard Neon branch (ep-sparkling-pond).
 * Fail-closed: only runs against ep-sparkling-pond endpoint.
 *
 * Usage: DATABASE_URL="..." ADMIN_AUTH_PEPPER="..." QA_ADMIN_EMAIL="..." QA_ADMIN_PASSWORD="..." \
 *   node scripts/create-admin-branch.cjs
 */
'use strict';

require('./preview-safety.js');

const ALLOWED_ENDPOINT = 'ep-sparkling-pond';

async function run() {
  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
  const qaEmail = (process.env.QA_ADMIN_EMAIL || '').toLowerCase().trim();
  const qaPassword = process.env.QA_ADMIN_PASSWORD || '';

  if (!dbUrl.includes(ALLOWED_ENDPOINT) || dbUrl.includes('a57hzmzw')) {
    console.error('❌ FAIL CLOSED: Expected ep-sparkling-pond endpoint.');
    process.exit(1);
  }
  if (!qaPassword || qaPassword.length < 14 || qaPassword.length > 128) {
    console.error('❌ QA_ADMIN_PASSWORD must be 14-128 chars. Set in .env.branch only.');
    process.exit(1);
  }
  if (!qaEmail || !qaEmail.includes('@')) {
    console.error('❌ QA_ADMIN_EMAIL must be a valid email.');
    process.exit(1);
  }

  const { hashPassword } = await import('../lib/admin-auth.js');
  const { neon } = await import('@neondatabase/serverless');

  const sql = neon(dbUrl);
  const passwordHash = await hashPassword(qaPassword);

  console.log(`Creating QA admin: ${qaEmail}`);
  await sql`
    INSERT INTO admin_users (email, password_hash, role, active)
    VALUES (${qaEmail}, ${passwordHash}, 'SUPER_ADMIN', true)
    ON CONFLICT (email) DO UPDATE SET
      password_hash = EXCLUDED.password_hash,
      role = 'SUPER_ADMIN',
      active = true,
      updated_at = CURRENT_TIMESTAMP
  `;

  const rows = await sql`SELECT email, role, active FROM admin_users WHERE email = ${qaEmail}`;
  if (rows.length === 0) throw new Error('User not found after insert');
  console.log('Verification:', JSON.stringify(rows[0]));
  console.log('✅ QA Admin created/updated successfully on ep-sparkling-pond.');
  process.exit(0);
}

run().catch(e => { console.error(e.message); process.exit(1); });
