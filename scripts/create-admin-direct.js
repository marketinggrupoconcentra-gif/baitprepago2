/**
 * scripts/create-admin-direct.js
 * 
 * Direct QA admin creation script (non-interactive).
 * For use ONLY in automated QA environments where stdin is not a TTY.
 * 
 * Password is NOT passed as a command-line argument.
 * It is read from the QA_ADMIN_PASSWORD env var (which must be set via .env.branch only,
 * never committed, and deleted after QA).
 * 
 * FAIL CLOSED: Same endpoint checks as create-admin.js
 */

require('./preview-safety.js');

const EXPECTED_ENDPOINT = process.env.EXPECTED_NEON_ENDPOINT_ID || 'ep-little-darkness';
const EXPECTED_BRANCH_ID = process.env.EXPECTED_NEON_BRANCH_ID || 'br-dark-frost-a54t4r79';

async function createAdminDirect() {
  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
  const qaPassword = process.env.QA_ADMIN_PASSWORD;
  const qaEmail = (process.env.QA_ADMIN_EMAIL || 'qa-admin@bait.invalid').toLowerCase().trim();

  if (!dbUrl.includes(EXPECTED_ENDPOINT) || dbUrl.includes('a57hzmzw')) {
    console.error('❌ FAIL CLOSED: Wrong database endpoint.');
    process.exit(1);
  }

  if (!qaPassword || qaPassword.length < 14 || qaPassword.length > 128) {
    console.error('❌ QA_ADMIN_PASSWORD must be 14-128 chars. Set in .env.branch only.');
    process.exit(1);
  }

  const { hashPassword } = await import('../lib/admin-auth.js');
  const { neon } = await import('@neondatabase/serverless');

  console.log(`Creating QA admin: ${qaEmail}`);
  const passwordHash = await hashPassword(qaPassword);

  const parts = passwordHash.split('$');
  if (!passwordHash.startsWith('scrypt$32768$8$3$') || parts[4].length !== 32 || parts[5].length !== 128) {
    console.error('❌ Hash format unexpected.');
    process.exit(1);
  }

  const sql = neon(dbUrl);

  // Upsert: if email exists, update password
  await sql`
    INSERT INTO admin_users (email, password_hash, role, active)
    VALUES (${qaEmail}, ${passwordHash}, 'SUPER_ADMIN', true)
    ON CONFLICT (email) DO UPDATE
    SET password_hash = EXCLUDED.password_hash,
        role = 'SUPER_ADMIN',
        active = true
  `;

  const users = await sql`
    SELECT email, role, active,
           starts_with(password_hash, 'scrypt$') as hash_valid
    FROM admin_users WHERE email = ${qaEmail}
  `;

  const u = users[0];
  console.log('Verification:');
  console.log(`  email:     ${u.email}`);
  console.log(`  role:      ${u.role}`);
  console.log(`  active:    ${u.active}`);
  console.log(`  hash_ok:   ${u.hash_valid}`);
  console.log(`  plaintext: NOT STORED`);

  if (!u.hash_valid || u.role !== 'SUPER_ADMIN' || !u.active) {
    console.error('❌ Verification failed.');
    process.exit(1);
  }

  console.log('✅ QA Admin created/updated successfully.');
  process.exit(0);
}

createAdminDirect().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
