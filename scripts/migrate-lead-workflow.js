/**
 * scripts/migrate-lead-workflow.js
 * Runner for Phase 1D-A Workflow Migration
 */

require('dotenv').config({ path: '.env.preview' });
const fs = require('fs');
const path = require('path');
const { Pool } = require('@neondatabase/serverless');
const { enforceSafety } = require('./preview-safety');

async function run() {
  // 1. Enforce Preview Safety (Fail Closed)
  enforceSafety();

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('❌ DATABASE_URL is required.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: dbUrl });

  const migrationPath = path.join(__dirname, '../db/migrations/003_lead_workflow.sql');
  if (!fs.existsSync(migrationPath)) {
    console.error(`❌ Migration file not found: ${migrationPath}`);
    process.exit(1);
  }

  console.log('✅ Applying migration 003_lead_workflow.sql...');
  const query = fs.readFileSync(migrationPath, 'utf8');

  try {
    await pool.query(query);
    console.log('✅ Migration 003_lead_workflow.sql applied successfully.');
    await pool.end();
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

run();
