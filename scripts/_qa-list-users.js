import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);
const rows = await sql`SELECT email, role, active FROM admin_users`;
console.log(JSON.stringify(rows, null, 2));
process.exit(0);
