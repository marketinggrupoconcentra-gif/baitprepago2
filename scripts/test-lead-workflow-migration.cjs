/**
 * scripts/test-lead-workflow-migration.cjs
 * Tests migration idempotency and data preservation.
 */

require('dotenv').config({ path: process.env.ENV_FILE || '.env.preview' });
const { neon } = require('@neondatabase/serverless');
const { execSync } = require('child_process');

async function run() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('❌ DATABASE_URL missing.');
    process.exit(1);
  }

  // Double check not prod
  if (dbUrl.includes('br-aged-recipe-a57hzmzw')) {
    console.error('❌ FAIL CLOSED: Trying to run destructive test on Production branch.');
    process.exit(1);
  }

  const sql = neon(dbUrl);

  console.log('🔄 Cleaning up any existing synthetic baseline lead...');
  await sql`DELETE FROM leads WHERE phone = '9999999999'`;

  console.log('📝 Inserting 1 synthetic baseline lead...');
  const insertResult = await sql`
    INSERT INTO leads (phone, utm_source, utm_medium, utm_campaign)
    VALUES ('9999999999', 'test_source', 'test_medium', 'test_campaign')
    RETURNING id
  `;
  const syntheticId = insertResult[0].id;
  console.log(`✅ Synthetic lead inserted with ID: ${syntheticId}`);

  console.log('\n🚀 --- MIGRATION RUN 1 ---');
  execSync('node scripts/migrate-lead-workflow.js', { env: process.env, stdio: 'inherit' });

  console.log('🔍 Checking state after RUN 1...');
  let lead = await sql`SELECT status, status_version, status_reason, status_updated_at FROM leads WHERE id = ${syntheticId}`;
  if (!lead[0] || lead[0].status !== 'NEW' || lead[0].status_version !== 1 || lead[0].status_reason !== null) {
    console.error('❌ RUN 1 FAILED: Lead state is incorrect.', lead[0]);
    process.exit(1);
  }
  console.log('✅ RUN 1 Verified: status=NEW, version=1, reason=null');

  console.log('\n🚀 --- MIGRATION RUN 2 ---');
  execSync('node scripts/migrate-lead-workflow.js', { env: process.env, stdio: 'inherit' });

  console.log('🔍 Checking state after RUN 2...');
  lead = await sql`SELECT status, status_version, status_reason FROM leads WHERE id = ${syntheticId}`;
  if (!lead[0] || lead[0].status !== 'NEW' || lead[0].status_version !== 1) {
    console.error('❌ RUN 2 FAILED: Lead state changed or lost.', lead[0]);
    process.exit(1);
  }
  console.log('✅ RUN 2 Verified: Idempotency confirmed.');

  console.log('\n🧹 Cleaning up synthetic lead...');
  await sql`DELETE FROM leads WHERE id = ${syntheticId}`;
  console.log('✅ Synthetic lead cleaned up.');

  console.log('🎉 Migration tests passed successfully.');
}

run().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
