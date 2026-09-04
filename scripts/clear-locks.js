import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../lib/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  const envPath = path.join(__dirname, '../.env.branch');
  const envFile = fs.readFileSync(envPath, 'utf-8');
  
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
  await sql`DELETE FROM admin_login_attempts`;
  console.log("Locks cleared.");
  process.exit(0);
}

run();
