
const { neon } = require('@neondatabase/serverless');
const { hashPassword } = require('./lib/admin-auth.js');
async function run() {
  const sql = neon(process.env.DATABASE_URL);
  const email = 'qa-admin@bait.invalid';
  const pwd = await hashPassword('testpassword123456');
  await sql`INSERT INTO admin_users (email, password_hash, role, active) VALUES (${email}, ${pwd}, 'SUPER_ADMIN', true)`;
  console.log('Admin created.');
}
run();
