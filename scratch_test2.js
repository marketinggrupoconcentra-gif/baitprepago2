const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
sql`SELECT * FROM lead_audit_logs`.then(console.log).catch(console.error);
