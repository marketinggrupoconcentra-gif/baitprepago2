import { neon } from '@neondatabase/serverless';

const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!dbUrl) { console.error('No DATABASE_URL'); process.exit(1); }

const sql = neon(dbUrl);

async function check() {
  // Check admin tables in Preview
  const tables = await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('admin_users','admin_sessions','admin_login_attempts','admin_audit_log')
    ORDER BY table_name
  `;
  console.log('ADMIN TABLES BEFORE (Preview):');
  console.log('Count:', tables.length);
  tables.forEach(t => console.log(' -', t.table_name));

  // Check constraints on admin_login_attempts if table exists
  if (tables.find(t => t.table_name === 'admin_login_attempts')) {
    const constraints = await sql`
      SELECT constraint_name, constraint_type
      FROM information_schema.table_constraints
      WHERE table_schema = 'public' AND table_name = 'admin_login_attempts'
    `;
    console.log('login_attempts constraints:', JSON.stringify(constraints));
    
    const rows = await sql`SELECT COUNT(*) as cnt FROM admin_login_attempts`;
    console.log('login_attempts rows:', rows[0].cnt);
    const userRows = await sql`SELECT COUNT(*) as cnt FROM admin_users`;
    console.log('admin_users rows:', userRows[0].cnt);
  }
  
  // Check schema for neon_auth
  const neonAuth = await sql`
    SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'neon_auth'
  `;
  console.log('neon_auth schema present:', neonAuth.length > 0 ? 'YES (inherited)' : 'NO');
}

check().catch(e => { console.error('Error:', e.message); process.exit(1); });
