import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';
import { resolveDbUrl, PRODUCTION_ENDPOINT_ID } from './preview-safety.js';

// Explicitly load ONLY .env.branch (QA config) if running locally
// Do NOT fallback to generic .env to avoid accidental production executions
dotenv.config({ path: '.env.branch' });

const EXPECTED_QA_ENDPOINT = 'ep-jolly-bread-avsqkawa';

function maskPhone(phone) {
  if (!phone || phone.length < 10) return phone;
  return phone.slice(0, 2) + '****' + phone.slice(-4);
}

const isExecute = process.argv.includes('--execute');

async function main() {
  console.log('=== QA HISTORICAL DUPLICATE CLEANUP ===');
  console.log(isExecute ? 'MODE: EXECUTE (Will mutate database)' : 'MODE: DRY-RUN (No mutations)');
  
  const env = process.env;
  
  if (env.VERCEL_ENV === 'production') {
    console.error('❌ FAIL CLOSED: VERCEL_ENV is production');
    process.exit(1);
  }

  const { url: primaryUrlStr } = resolveDbUrl(env);
  const dupUrlStr = env.DUPLICATES_DATABASE_URL;

  if (!primaryUrlStr) {
    console.error('❌ FAIL CLOSED: Primary DB URL not set');
    process.exit(1);
  }
  if (!dupUrlStr) {
    console.error('❌ FAIL CLOSED: DUPLICATES_DATABASE_URL not set');
    process.exit(1);
  }

  // Parse URLs
  let primaryUrl, dupUrl;
  try {
    primaryUrl = new URL(primaryUrlStr);
    dupUrl = new URL(dupUrlStr);
  } catch (err) {
    console.error('❌ FAIL CLOSED: Invalid database URL format');
    process.exit(1);
  }

  // Primary URL validation
  if (!primaryUrl.hostname.startsWith(EXPECTED_QA_ENDPOINT + '.')) {
    console.error(`❌ FAIL CLOSED: Primary DB hostname does not match expected QA endpoint (${EXPECTED_QA_ENDPOINT})`);
    process.exit(1);
  }
  if (primaryUrl.pathname !== '/neondb') {
    console.error(`❌ FAIL CLOSED: Primary DB name is not neondb`);
    process.exit(1);
  }

  // Secondary URL validation
  if (!dupUrl.hostname.startsWith(EXPECTED_QA_ENDPOINT + '.')) {
    console.error(`❌ FAIL CLOSED: Duplicates DB hostname does not match expected QA endpoint (${EXPECTED_QA_ENDPOINT})`);
    process.exit(1);
  }
  if (dupUrl.pathname !== '/baitprepago_duplicates') {
    console.error(`❌ FAIL CLOSED: Duplicates DB name is not baitprepago_duplicates`);
    process.exit(1);
  }

  // Cross-check against production
  if (primaryUrlStr.includes(PRODUCTION_ENDPOINT_ID) || dupUrlStr.includes(PRODUCTION_ENDPOINT_ID)) {
    console.error(`❌ FAIL CLOSED: A URL contains the Production endpoint ID!`);
    process.exit(1);
  }

  console.log('✅ Safety checks passed. Connecting to QA databases...');

  const sql = neon(primaryUrlStr);
  const duplicatesSql = neon(dupUrlStr);

  try {
    // 1. Identify phones with duplicates
    const duplicatePhones = await sql`
      SELECT phone, COUNT(*) as count 
      FROM leads 
      GROUP BY phone 
      HAVING COUNT(*) > 1
    `;

    if (duplicatePhones.length === 0) {
      console.log('No historical duplicates found.');
      process.exit(0);
    }

    console.log(`Found ${duplicatePhones.length} duplicate group(s).`);

    let totalCopied = 0;
    let totalDeleted = 0;

    for (const group of duplicatePhones) {
      const masked = maskPhone(group.phone);
      console.log(`\nProcessing phone: ${masked} (Count: ${group.count})`);

      // 2. Fetch all leads for this phone, ordered by created_at ASC, id ASC
      const rows = await sql`
        SELECT * 
        FROM leads 
        WHERE phone = ${group.phone} 
        ORDER BY created_at ASC, id ASC
      `;

      if (rows.length < 2) continue; // Should not happen based on GROUP BY

      const canonical = rows[0];
      const duplicates = rows.slice(1);

      console.log(`  Canonical Lead ID: ${canonical.id} (Created at: ${canonical.created_at})`);
      console.log(`  Duplicates to move: ${duplicates.length}`);

      for (const dup of duplicates) {
        console.log(`    -> Target Lead ID: ${dup.id} (Created at: ${dup.created_at})`);

        if (isExecute) {
          // A. Check if already copied (idempotency)
          const existingCopy = await duplicatesSql`
            SELECT id FROM duplicate_leads 
            WHERE source_lead_id = ${dup.id} 
              AND reason = 'HISTORICAL_QA_CLEANUP'
          `;

          if (existingCopy.length > 0) {
            console.log(`       ⚠️ Lead ${dup.id} was already copied to secondary DB. Proceeding to verify primary deletion.`);
          } else {
            // B. Attempt COPY
            console.log(`       [COPY] Inserting into secondary DB...`);
            await duplicatesSql`
              INSERT INTO duplicate_leads (
                phone, email, duplicate_of_lead_id, reason, source_lead_id,
                utm_source, utm_medium, utm_campaign, utm_content, utm_term,
                fbclid, fb_ad_id, fb_adset_id, fb_campaign_id,
                ip, user_agent, referrer, page_url, created_at
              ) VALUES (
                ${dup.phone}, ${dup.email}, ${canonical.id}, 'HISTORICAL_QA_CLEANUP', ${dup.id},
                ${dup.utm_source}, ${dup.utm_medium}, ${dup.utm_campaign}, ${dup.utm_content}, ${dup.utm_term},
                ${dup.fbclid}, ${dup.fb_ad_id}, ${dup.fb_adset_id}, ${dup.fb_campaign_id},
                ${dup.ip}, ${dup.user_agent}, ${dup.referrer}, ${dup.page_url}, ${dup.created_at}
              )
            `;
            totalCopied++;
          }

          // C. Read back to strictly verify the copy before deletion
          const verifyCopy = await duplicatesSql`
            SELECT id FROM duplicate_leads 
            WHERE source_lead_id = ${dup.id} 
              AND reason = 'HISTORICAL_QA_CLEANUP'
          `;

          if (verifyCopy.length !== 1) {
             throw new Error(`CRITICAL: Verification read failed for source_lead_id=${dup.id}. Expected 1 copy, found ${verifyCopy.length}. Aborting deletion.`);
          }

          // D. Delete from primary
          console.log(`       [DELETE] Removing from primary DB...`);
          
          // Use an explicit query to count affected rows, or delete returning to ensure 1 row
          const deletedRows = await sql`
            DELETE FROM leads WHERE id = ${dup.id} RETURNING id
          `;
          
          if (deletedRows.length === 1) {
            console.log(`       ✅ Successfully moved and deleted lead ${dup.id}.`);
            totalDeleted++;
          } else if (deletedRows.length === 0) {
             console.log(`       ⚠️ Lead ${dup.id} was already deleted from primary DB.`);
          } else {
             throw new Error(`CRITICAL: Delete operation on primary DB returned ${deletedRows.length} rows for id=${dup.id}.`);
          }

        }
      }
    }

    if (isExecute) {
      console.log(`\nCleanup complete. Copied ${totalCopied} rows and deleted ${totalDeleted} rows.`);
    } else {
      console.log(`\nDry run complete. Use --execute to actually mutate data.`);
    }

  } catch (error) {
    console.error('ERROR during cleanup:', error);
  }
}

main();
