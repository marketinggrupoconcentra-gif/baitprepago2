const fs = require('fs');
const envData = fs.readFileSync('.env.local', 'utf8');
const lines = envData.split('\n');
for (const line of lines) {
  if (line.startsWith('DATABASE_URL=')) {
    process.env.DATABASE_URL = line.split('=')[1].replace(/^"|"$/g, '').trim();
  }
}
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
async function check() {
  const res = await sql`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'leads'
    ORDER BY ordinal_position
  `;
  console.log(JSON.stringify(res, null, 2));
}
check().catch(e => { console.error(e.message); process.exit(1); });
