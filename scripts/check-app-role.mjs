/**
 * Check bait_app_prod permissions on both databases.
 * Uses owner credentials temporarily to verify app role exists.
 */
import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const sql = neon(process.env.DATABASE_URL);

// Check if bait_app_prod role exists
const roleCheck = await sql`
  SELECT rolname, rolcanlogin, rolcreatedb, rolsuper 
  FROM pg_roles 
  WHERE rolname = 'bait_app_prod'
`;

console.log('bait_app_prod role exists:', roleCheck.length > 0 ? 'YES' : 'NO');
if (roleCheck.length > 0) {
  const role = roleCheck[0];
  console.log('  canlogin:', role.rolcanlogin);
  console.log('  createdb:', role.rolcreatedb);
  console.log('  superuser:', role.rolsuper);
}

// Check grants on leads table
const grantsLeads = await sql`
  SELECT privilege_type 
  FROM information_schema.role_table_grants 
  WHERE table_name = 'leads' AND grantee = 'bait_app_prod'
`;
console.log('\nbait_app_prod grants on leads:', grantsLeads.map(r => r.privilege_type).join(', ') || 'NONE');

// Check grants on duplicate_leads in baitprepago_duplicates
// We can't cross-database check with neon HTTP, but we can confirm the role
const dupSql = neon(process.env.DUPLICATES_DATABASE_URL);
const roleCheckDup = await dupSql`
  SELECT rolname FROM pg_roles WHERE rolname = 'bait_app_prod'
`;
console.log('\nbait_app_prod role in duplicates DB:', roleCheckDup.length > 0 ? 'EXISTS' : 'NOT FOUND');

const grantsOnDup = await dupSql`
  SELECT privilege_type 
  FROM information_schema.role_table_grants 
  WHERE table_name = 'duplicate_leads' AND grantee = 'bait_app_prod'
`;
console.log('bait_app_prod grants on duplicate_leads:', grantsOnDup.map(r => r.privilege_type).join(', ') || 'NONE');
