import { neon } from '@neondatabase/serverless';

const dbUrl = process.env.PROD_DB_URL;
if (!dbUrl) {
  console.error("No PROD_DB_URL");
  process.exit(1);
}

async function verify() {
  const sql = neon(dbUrl);
  const tz = await sql`SHOW timezone`;
  console.log(`TIMEZONE: ${tz[0].TimeZone}`);

  const users = await sql`SELECT email, role, active FROM admin_users`;
  console.log("USERS:");
  users.forEach(u => console.log(`- ${u.email} (${u.role}) Active: ${u.active}`));

  process.exit(0);
}

verify().catch(e => {
  console.error(e);
  process.exit(1);
});
