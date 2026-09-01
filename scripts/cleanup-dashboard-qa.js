/**
 * scripts/cleanup-dashboard-qa.js
 *
 * Removes ONLY the QA synthetic leads seeded by seed-dashboard-qa.js.
 * Identifies rows using utm_source='qa-dashboard' AND utm_campaign LIKE 'stage-1b-%'.
 * FAIL CLOSED: aborts if connected to Production endpoint.
 *
 * Usage: node --env-file=.env.branch scripts/cleanup-dashboard-qa.js [campaign-id]
 *
 * If campaign-id not passed, reads from .qa-seed-run-id file.
 */

const ALLOWED_ENDPOINTS = ['ep-little-darkness', 'ep-sparkling-pond'];
const PRODUCTION_ENDPOINT     = 'a57hzmzw';
const QA_SOURCE               = 'qa-dashboard';

function failClose(reason) {
  console.error(`\n⛔ FAIL CLOSED: ${reason}`);
  process.exit(1);
}

async function main() {
  const dbUrl = process.env.DATABASE_URL || '';

  if (!dbUrl) failClose('DATABASE_URL not set');
  if (!ALLOWED_ENDPOINTS.some(ep => dbUrl.includes(ep)))
    failClose(`Expected Preview endpoint not found in DATABASE_URL`);
  if (dbUrl.includes(PRODUCTION_ENDPOINT))
    failClose('Production endpoint detected — refusing to delete');

  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(dbUrl);

  // Determine campaign tag
  let campaign = process.argv[2] || null;
  if (!campaign) {
    const { existsSync, readFileSync } = await import('fs');
    if (existsSync('.qa-seed-run-id')) {
      campaign = readFileSync('.qa-seed-run-id', 'utf8').trim();
    }
  }

  console.log('\n🧹 Dashboard QA Cleanup');

  if (campaign) {
    console.log(`   Targeting campaign: ${campaign}`);
    const deleted = await sql`
      DELETE FROM leads
      WHERE utm_source = ${QA_SOURCE}
        AND utm_campaign = ${campaign}
      RETURNING id
    `;
    console.log(`   Deleted: ${deleted.length} rows`);
  } else {
    // Fallback: delete ALL qa-dashboard rows (broader cleanup)
    console.log('   No campaign ID found — deleting ALL qa-dashboard rows');
    const deleted = await sql`
      DELETE FROM leads
      WHERE utm_source = ${QA_SOURCE}
        AND utm_campaign LIKE 'stage-1b-%'
      RETURNING id
    `;
    console.log(`   Deleted: ${deleted.length} rows`);
  }

  // Capture residual count
  const residual = await sql`
    SELECT COUNT(*) AS cnt FROM leads WHERE utm_source = ${QA_SOURCE}
  `;
  const remaining = Number(residual[0].cnt);

  if (remaining > 0) {
    console.warn(`\n⚠️  ${remaining} qa-dashboard rows still remain (other campaign IDs)`);
  } else {
    console.log('\n✅ All qa-dashboard leads removed.');
  }

  // Remove temp file
  const { existsSync, unlinkSync } = await import('fs');
  if (existsSync('.qa-seed-run-id')) {
    unlinkSync('.qa-seed-run-id');
    console.log('   .qa-seed-run-id removed.');
  }

  process.exit(0);
}

main().catch(e => { console.error(e.message); process.exit(1); });
