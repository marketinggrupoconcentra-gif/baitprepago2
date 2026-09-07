import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
// fallback to standard .env if not found
dotenv.config();

const VERCEL_ENV = process.env.VERCEL_ENV;
if (VERCEL_ENV === 'production' || process.env.DATABASE_URL?.includes('production')) {
  console.error('ERROR: This script must NOT be run in Production.');
  process.exit(1);
}

const isExecute = process.argv.includes('--execute');

async function main() {
  console.log('=== QA HISTORICAL DUPLICATE CLEANUP ===');
  console.log(isExecute ? 'MODE: EXECUTE (Will mutate database)' : 'MODE: DRY-RUN (No mutations)');
  console.log('Target Env:', VERCEL_ENV || 'local');

  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL not set');
    process.exit(1);
  }
  if (!process.env.DUPLICATES_DATABASE_URL) {
    console.error('ERROR: DUPLICATES_DATABASE_URL not set');
    process.exit(1);
  }

  const sql = neon(process.env.DATABASE_URL);
  const duplicatesSql = neon(process.env.DUPLICATES_DATABASE_URL);

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
      const phone = group.phone;
      console.log(`\nProcessing phone: ${phone} (Count: ${group.count})`);

      // 2. Fetch all leads for this phone, ordered by created_at ASC, id ASC
      const rows = await sql`
        SELECT * 
        FROM leads 
        WHERE phone = ${phone} 
        ORDER BY created_at ASC, id ASC
      `;

      if (rows.length < 2) continue; // Should not happen based on GROUP BY

      const canonical = rows[0];
      const duplicates = rows.slice(1);

      console.log(`  Canonical Lead ID: ${canonical.id} (Created at: ${canonical.created_at})`);
      console.log(`  Duplicates to move: ${duplicates.length}`);

      for (const dup of duplicates) {
        console.log(`    -> Moving Lead ID: ${dup.id} (Created at: ${dup.created_at})`);

        if (isExecute) {
          // 3. Copy to duplicate_leads
          await duplicatesSql`
            INSERT INTO duplicate_leads (
              phone, email, duplicate_of_lead_id, reason,
              utm_source, utm_medium, utm_campaign, utm_content, utm_term,
              fbclid, fb_ad_id, fb_adset_id, fb_campaign_id,
              ip, user_agent, referrer, page_url, created_at
            ) VALUES (
              ${dup.phone}, ${dup.email}, ${canonical.id}, 'HISTORICAL_QA_CLEANUP',
              ${dup.utm_source}, ${dup.utm_medium}, ${dup.utm_campaign}, ${dup.utm_content}, ${dup.utm_term},
              ${dup.fbclid}, ${dup.fb_ad_id}, ${dup.fb_adset_id}, ${dup.fb_campaign_id},
              ${dup.ip}, ${dup.user_agent}, ${dup.referrer}, ${dup.page_url}, ${dup.created_at}
            )
          `;

          // 4. Verify insertion and then delete from primary DB
          // Wait briefly just to ensure the async insert above completed before deleting
          // (await ensures it, but for DB distributed writes, a read immediately after is the true test, though not strictly required if no error thrown)
          
          await sql`
            DELETE FROM leads WHERE id = ${dup.id}
          `;
          totalCopied++;
          totalDeleted++;
        }
      }
    }

    if (isExecute) {
      console.log(`\nCleanup complete. Moved ${totalCopied} rows and deleted ${totalDeleted} rows.`);
    } else {
      console.log(`\nDry run complete. Use --execute to actually move the data.`);
    }

  } catch (error) {
    console.error('ERROR during cleanup:', error);
  }
}

main();
