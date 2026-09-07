/**
 * Production state check — READ ONLY, no mutations.
 */
import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function checkPrimary() {
  const sql = neon(process.env.DATABASE_URL);
  
  const tzRes = await sql`SELECT current_setting('TimeZone') AS tz`;
  console.log('Primary timezone:', tzRes[0].tz);

  const countRes = await sql`SELECT COUNT(*) as total FROM leads`;
  console.log('Primary leads count:', countRes[0].total);

  const dupRes = await sql`
    SELECT COUNT(*) as dup_groups FROM (
      SELECT phone, COUNT(*) FROM leads GROUP BY phone HAVING COUNT(*) > 1
    ) sub
  `;
  console.log('Primary duplicate groups:', dupRes[0].dup_groups);

  const constraintRes = await sql`
    SELECT constraint_name FROM information_schema.table_constraints
    WHERE table_name = 'leads' AND constraint_type = 'UNIQUE'
    AND constraint_name LIKE '%phone%'
  `;
  console.log('UNIQUE(phone) constraint:', constraintRes.length > 0 ? 'YES' : 'NO');

  const colRes = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'leads' AND column_name IN ('first_name', 'last_name')
  `;
  const cols = colRes.map(r => r.column_name);
  console.log('first_name column:', cols.includes('first_name') ? 'YES' : 'NO');
  console.log('last_name column:', cols.includes('last_name') ? 'YES' : 'NO');

  const leadColsRes = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'leads'
    ORDER BY ordinal_position
  `;
  const leadCols = leadColsRes.map(r => r.column_name);
  console.log('leads columns:', leadCols.join(', '));
  console.log('NIP column present:', leadCols.includes('nip') ? 'YES - WARNING' : 'NO - CORRECT');
}

async function checkDuplicates() {
  const connStr = process.env.DUPLICATES_DATABASE_URL;
  if (!connStr) {
    console.log('\nDUPLICATES_DATABASE_URL: NOT SET');
    return;
  }
  try {
    const sql = neon(connStr);
    const tzRes = await sql`SELECT current_setting('TimeZone') AS tz, current_database() AS db`;
    console.log('\nDuplicates DB:', tzRes[0].db, '| timezone:', tzRes[0].tz);

    const countRes = await sql`SELECT COUNT(*) as total FROM duplicate_leads`;
    console.log('Duplicate records count:', countRes[0].total);
  } catch (err) {
    console.log('\nDuplicates DB error:', err.message);
  }
}

console.log('=== PRODUCTION STATE CHECK ===\n');
await checkPrimary().catch(err => console.error('Primary DB error:', err.message));
await checkDuplicates();
console.log('\n=== DONE ===');
