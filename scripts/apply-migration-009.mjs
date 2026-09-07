/**
 * Apply migration 009: adds first_name and last_name to leads table.
 * Uses owner credentials from DATABASE_URL in .env.local.
 * READ & WRITES to production neondb.
 */
import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const sql = neon(process.env.DATABASE_URL);

console.log('=== APPLYING MIGRATION 009: lead registered name ===\n');

// Step 1: Verify timezone
const tzRes = await sql`SELECT current_setting('TimeZone') AS tz, current_database() AS db`;
console.log('Database:', tzRes[0].db);
console.log('Timezone:', tzRes[0].tz);

if (tzRes[0].tz !== 'America/Mexico_City') {
  console.error(`ABORT: Timezone is ${tzRes[0].tz}, expected America/Mexico_City`);
  process.exit(1);
}

// Step 2: Check if columns already exist (idempotent)
const colCheck = await sql`
  SELECT column_name FROM information_schema.columns
  WHERE table_name = 'leads' AND column_name IN ('first_name', 'last_name')
`;
const existingCols = colCheck.map(r => r.column_name);
console.log('Existing name columns:', existingCols.length ? existingCols.join(', ') : 'NONE');

if (existingCols.includes('first_name') && existingCols.includes('last_name')) {
  console.log('\nMigration 009 already applied (both columns exist). IDEMPOTENT - DONE.');
  process.exit(0);
}

// Step 3: Count leads before (ensure no accidental data loss)
const countBefore = await sql`SELECT COUNT(*) as total FROM leads`;
console.log('\nLeads before migration:', countBefore[0].total);

// Step 4: Apply migration
console.log('\nApplying ALTER TABLE...');
if (!existingCols.includes('first_name')) {
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS first_name VARCHAR(120)`;
  console.log('  + first_name VARCHAR(120) added');
}
if (!existingCols.includes('last_name')) {
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_name VARCHAR(160)`;
  console.log('  + last_name VARCHAR(160) added');
}

// Step 5: Add comments
await sql`COMMENT ON COLUMN leads.first_name IS 'Nombre(s) registrado(s) por el titular de la solicitud'`;
await sql`COMMENT ON COLUMN leads.last_name IS 'Apellido(s) registrado(s) por el titular de la solicitud'`;
console.log('  + Column comments added');

// Step 6: Verify
const colVerify = await sql`
  SELECT column_name, character_maximum_length FROM information_schema.columns
  WHERE table_name = 'leads' AND column_name IN ('first_name', 'last_name')
  ORDER BY column_name
`;
console.log('\nVerification:');
for (const col of colVerify) {
  console.log(`  ${col.column_name}: VARCHAR(${col.character_maximum_length})`);
}

// Step 7: Count after (no data loss)
const countAfter = await sql`SELECT COUNT(*) as total FROM leads`;
console.log('\nLeads after migration:', countAfter[0].total);

if (countBefore[0].total !== countAfter[0].total) {
  console.error('ABORT: Lead count changed! Expected no data mutations.');
  process.exit(1);
}

// Step 8: Verify NIP not present
const nipCheck = await sql`
  SELECT column_name FROM information_schema.columns
  WHERE table_name = 'leads' AND column_name IN ('nip', 'nip_valid_until')
`;
console.log('\nNIP columns present:', nipCheck.length > 0 ? 'YES - WARNING' : 'NONE - CORRECT');

console.log('\n=== MIGRATION 009 APPLIED SUCCESSFULLY ===');
