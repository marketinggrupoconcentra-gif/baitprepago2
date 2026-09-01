const fs = require('fs');
const path = require('path');
const { getDb } = require('../lib/db.js');
require('./preview-safety.js');

async function migrateAdmin() {
  try {
    console.log('Starting Admin Migration...');


    const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
    if (!dbUrl.includes('ep-little-darkness')) {
      console.error('MIGRATION ABORTED: The DATABASE_URL does not match the preview-admin-auth endpoint (ep-little-darkness).');
      process.exit(1);
    }
    
    const sql = getDb();

    console.log('Reading migration file...');
    const migrationPath = path.join(__dirname, '..', 'db', 'migrations', '002_admin_auth.sql');
    const ddl = fs.readFileSync(migrationPath, 'utf8');

    console.log('Executing Admin DDL on Preview...');
    const statements = ddl
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    for (const statement of statements) {
      console.log(`Executing: ${statement.substring(0, 50).replace(/\r?\n/g, ' ')}...`);
      await sql.unsafe(statement); 
    }

    console.log('Admin Migration applied successfully on Preview.');
    process.exit(0);

  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

migrateAdmin();
