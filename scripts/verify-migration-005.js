/**
 * scripts/verify-migration-005.js
 * Read-only verification queries for Stage 1H / Migration 005.
 */
const { Pool } = require('@neondatabase/serverless');
const { enforceSafety } = require('./preview-safety');

async function run() {
  enforceSafety();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const tz = await pool.query(`SELECT current_setting('TimeZone') AS tz`);
  console.log('timezone:', tz.rows[0].tz);

  const emailCol = await pool.query(`
    SELECT column_name, data_type, is_nullable FROM information_schema.columns
    WHERE table_schema='public' AND table_name='leads' AND column_name='email'
  `);
  console.log('leads.email column:', emailCol.rows);

  const captchaTable = await pool.query(`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_schema='public' AND table_name='captcha_challenges'
    ORDER BY ordinal_position
  `);
  console.log('captcha_challenges columns:', captchaTable.rows);

  const naiveTimestamps = await pool.query(`
    SELECT count(*)::int AS count FROM information_schema.columns
    WHERE table_schema='public' AND data_type='timestamp without time zone'
  `);
  console.log('naive timestamp columns (must be 0):', naiveTimestamps.rows[0].count);

  const nipCols = await pool.query(`
    SELECT count(*)::int AS count FROM information_schema.columns
    WHERE table_schema='public' AND table_name='leads' AND column_name IN ('nip','nip_valid_until')
  `);
  console.log('nip/nip_valid_until columns on leads (must be 0):', nipCols.rows[0].count);

  await pool.end();
}

run().catch(err => { console.error(err); process.exit(1); });
