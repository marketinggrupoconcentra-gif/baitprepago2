/**
 * scripts/seed-dashboard-qa.js
 *
 * Seeds synthetic leads in the Preview Neon branch for dashboard QA.
 * FAIL CLOSED: aborts if connected to Production endpoint.
 *
 * Usage: node --env-file=.env.branch scripts/seed-dashboard-qa.js
 *
 * Seed rows are tagged: utm_source='qa-dashboard', utm_campaign='stage-1b-<RUN_ID>'
 * so cleanup-dashboard-qa.js can find and remove them precisely.
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const PREVIEW_ENDPOINT_PREFIX = 'ep-little-darkness';
const PRODUCTION_ENDPOINT     = 'a57hzmzw';
const QA_SOURCE               = 'qa-dashboard';
const SEED_COUNT               = 9; // must be small and deterministic

function failClose(reason) {
  console.error(`\n⛔ FAIL CLOSED: ${reason}`);
  process.exit(1);
}

async function main() {
  const dbUrl = process.env.DATABASE_URL || '';

  if (!dbUrl) failClose('DATABASE_URL not set');
  if (!dbUrl.includes(PREVIEW_ENDPOINT_PREFIX))
    failClose(`Expected Preview endpoint (${PREVIEW_ENDPOINT_PREFIX}) not found in DATABASE_URL`);
  if (dbUrl.includes(PRODUCTION_ENDPOINT))
    failClose('Production endpoint detected — refusing to seed');

  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(dbUrl);

  // Unique run ID so cleanup can target exactly this seed
  const runId = `stage-1b-${Date.now()}`;
  const campaign = runId;

  console.log('\n🌱 Dashboard QA Seed');
  console.log(`   Campaign tag: ${campaign}`);

  // ── Capture baseline ────────────────────────────────────────────────
  const before = await sql`
    SELECT
      COUNT(*)                                                                    AS total,
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours')         AS last_24h,
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')           AS last_7d
    FROM leads
  `;
  const baseline = {
    total:   Number(before[0].total),
    last24h: Number(before[0].last_24h),
    last7d:  Number(before[0].last_7d)
  };
  console.log('\n📊 Baseline BEFORE seed:');
  console.log(`   total=${baseline.total}  last_24h=${baseline.last24h}  last_7d=${baseline.last7d}`);

  // ── Synthetic row definitions ────────────────────────────────────────
  const SOURCES   = ['google', 'facebook', 'google', 'organic', 'facebook', 'google', 'direct', 'tiktok', 'google'];
  const MEDIUMS   = ['cpc',  'cpm',   'cpc',  null,       'paid',     'cpc',   null,     'paid',   'cpc'];
  const PHONES    = ['5500000001','5500000002','5500000003','5500000004','5500000005',
                     '5500000006','5500000007','5500000008','5500000009'];
  // createdAt: stagger across last 7 days so trend chart has variety
  const now = Date.now();
  const ONE_DAY_MS = 86400000;

  for (let i = 0; i < SEED_COUNT; i++) {
    const offsetMs   = i * (6 * 3600000); // 6-hour apart
    const created_at = new Date(now - (6 * ONE_DAY_MS) + offsetMs);

    await sql`
      INSERT INTO leads (
        created_at, phone, utm_source, utm_medium, utm_campaign,
        ip, user_agent
      ) VALUES (
        ${created_at.toISOString()},
        ${PHONES[i]},
        ${SOURCES[i]},
        ${MEDIUMS[i]},
        ${campaign},
        ${'192.0.2.0'},
        ${'QA-Seed/1.0'}
      )
    `;
  }

  // ── Capture after ───────────────────────────────────────────────────
  const after = await sql`
    SELECT
      COUNT(*)                                                                    AS total,
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours')         AS last_24h,
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')           AS last_7d
    FROM leads
  `;
  const post = {
    total:   Number(after[0].total),
    last24h: Number(after[0].last_24h),
    last7d:  Number(after[0].last_7d)
  };
  console.log('\n📊 Metrics AFTER seed:');
  console.log(`   total=${post.total}  last_24h=${post.last24h}  last_7d=${post.last7d}`);
  console.log(`\n   Delta total:   ${post.total   - baseline.total}   (expected ${SEED_COUNT})`);
  console.log(`   Delta last_7d: ${post.last7d  - baseline.last7d} (expected ${SEED_COUNT})`);

  if (post.total - baseline.total !== SEED_COUNT) {
    failClose(`Unexpected delta: got ${post.total - baseline.total}, expected ${SEED_COUNT}`);
  }

  // Write run ID to a temp file so cleanup script can use it
  const { writeFileSync } = await import('fs');
  writeFileSync('.qa-seed-run-id', campaign, 'utf8');

  console.log(`\n✅ Seeded ${SEED_COUNT} synthetic leads.`);
  console.log(`   Run ID stored in .qa-seed-run-id`);
  console.log(`   To clean up: node --env-file=.env.branch scripts/cleanup-dashboard-qa.js`);
  process.exit(0);
}

main().catch(e => { console.error(e.message); process.exit(1); });
