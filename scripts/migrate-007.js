const fs = require('fs');
const path = require('path');
const { Pool } = require('@neondatabase/serverless');
const { enforceSafety } = require('./preview-safety');

async function run() {
  enforceSafety();

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('❌ DATABASE_URL is required.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: dbUrl });

  const tzRes = await pool.query(
    `SELECT current_database() AS db, current_user AS usr, current_setting('TimeZone') AS tz`
  );
  const { db, usr, tz } = tzRes.rows[0];
  console.log(`ℹ️  database=${db} user=${usr} timezone=${tz}`);
  if (tz !== 'America/Mexico_City') {
    console.error(`❌ FAIL CLOSED: effective TimeZone is "${tz}", expected "America/Mexico_City".`);
    await pool.end();
    process.exit(1);
  }

  const migrationPath = path.join(__dirname, '../db/migrations/007_password_resets.sql');
  const query = fs.readFileSync(migrationPath, 'utf8');

  try {
    await pool.query(query);
    console.log('✅ Migration 007_password_resets.sql applied successfully.');
    await pool.end();
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

run();
