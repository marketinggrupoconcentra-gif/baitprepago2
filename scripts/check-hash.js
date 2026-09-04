import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { hashPassword, verifyPassword } from '../lib/admin-auth.js';
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
  
  const targetEmail = 'qa-dashboard@bait.test';
  const rows = await sql`SELECT email, role, active, password_hash FROM admin_users WHERE email = ${targetEmail}`;
  const user = rows[0];
  
  console.log("DB Hash:", user.password_hash);
  
  const expectedPassword = process.env.QA_ADMIN_PASSWORD;
  console.log("Password set:", expectedPassword);
  
  const isMatch = await verifyPassword(expectedPassword, user.password_hash);
  console.log("Does local verify match DB hash?:", isMatch);

  process.exit(0);
}

run();
