import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

await sql`SET search_path TO app`;
const [count] = await sql`SELECT COUNT(*)::int as total FROM app.leads`;
console.log(`\n📊 Total leads en DB: ${count.total}`);

if (count.total > 0) {
  const rows = await sql`
    SELECT
      id,
      public_reference,
      status,
      state_code,
      created_at
    FROM app.leads
    ORDER BY created_at DESC
    LIMIT 5
  `;
  console.log('\n📋 Últimos leads:');
  rows.forEach(r => console.log(`  - [${r.status}] ${r.public_reference} | ${r.state_code} | ${new Date(r.created_at).toLocaleString('es-MX')}`));
} else {
  console.log('  ⚠️  No hay leads en la base de datos aún.');
}
