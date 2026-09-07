require('./scripts/preview-safety.js');
const { neon } = require('@neondatabase/serverless');

async function seedViewer() {
  const dbUrl = process.env.DATABASE_URL;
  const sql = neon(dbUrl);
  const { hashPassword } = await import('./lib/admin-auth.js');
  
  const qaEmail = process.env.QA_VIEWER_EMAIL;
  const qaPassword = process.env.QA_VIEWER_PASSWORD;
  const passwordHash = await hashPassword(qaPassword);
  
  await sql`
    INSERT INTO admin_users (email, password_hash, role, active)
    VALUES (${qaEmail}, ${passwordHash}, 'VIEWER', true)
    ON CONFLICT (email) DO UPDATE
    SET password_hash = EXCLUDED.password_hash,
        role = 'VIEWER',
        active = true
  `;
  console.log('Seeded QA_VIEWER_EMAIL');
}

seedViewer().catch(console.error);
