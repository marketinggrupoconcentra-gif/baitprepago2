import fs from 'fs';
import { getDb } from '../lib/db.js';

async function run() {
  const envFile = fs.readFileSync('.env.branch', 'utf-8');
  envFile.split('\n').forEach(line => {
    if (line.includes('=')) {
      const parts = line.split('=');
      const key = parts[0].trim();
      let val = parts.slice(1).join('=').trim();
      if (val.startsWith('"') && val.endsWith('"')) {
        val = val.substring(1, val.length - 1);
      }
      process.env[key] = val;
    }
  });
  const sql = getDb();
  const locks = await sql`SELECT count(*) FROM admin_login_attempts`;
  console.log('Locks count:', locks[0].count);
  process.exit(0);
}
run();
