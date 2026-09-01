'use strict';
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

async function main() {
  const [u, s, a, al, l] = await Promise.all([
    sql`SELECT count(*)::int as n FROM admin_users`,
    sql`SELECT count(*)::int as n FROM admin_sessions`,
    sql`SELECT count(*)::int as n FROM admin_login_attempts`,
    sql`SELECT count(*)::int as n FROM admin_audit_log`,
    sql`SELECT count(*)::int as n FROM leads`
  ]);
  console.log('admin_users:', u[0].n);
  console.log('admin_sessions:', s[0].n);
  console.log('admin_login_attempts:', a[0].n);
  console.log('admin_audit_log:', al[0].n);
  console.log('leads:', l[0].n);
}
main().catch(e => { console.error(e.message); process.exit(1); });
