/**
 * Reset bait_app_prod password using Neon Client.
 * The password is safely constructed as a base64url string (no special chars).
 */
import { Client, neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';
import crypto from 'crypto';
import fs from 'fs';
dotenv.config({ path: '.env.local' });

// Generate a secure random password
// base64url chars: A-Z, a-z, 0-9, -, _  — none of these need SQL escaping
const newPassword = crypto.randomBytes(24).toString('base64url');

// Verify only safe chars (belts and suspenders)
if (!/^[A-Za-z0-9_-]+$/.test(newPassword)) {
  console.error('ABORT: Generated password has unexpected characters');
  process.exit(1);
}

const pooledUrl = process.env.DATABASE_URL;
const parsedPooled = new URL(pooledUrl);

console.log('Connecting via WebSocket client...');
const client = new Client(pooledUrl);
await client.connect();

console.log('Resetting bait_app_prod password...');
// PostgreSQL ALTER ROLE doesn't accept $1 params. Embed the literal password.
// Since base64url chars are [A-Za-z0-9_-], the quoting is safe.
await client.query(`ALTER ROLE bait_app_prod WITH PASSWORD '${newPassword}'`);
console.log('Password reset successful.');
await client.end();

// Build connection strings
const hostname = parsedPooled.hostname; // pooler hostname for runtime
const primaryConnStr = `postgresql://bait_app_prod:${newPassword}@${hostname}/neondb?sslmode=require&channel_binding=require`;
const dupConnStr = `postgresql://bait_app_prod:${newPassword}@${hostname}/baitprepago_duplicates?sslmode=require&channel_binding=require`;

// Save to temp file
const envContent = `# bait_app_prod connection strings — TEMPORARY
# Generated at: ${new Date().toISOString()}
# DELETE THIS FILE AFTER CONFIGURING VERCEL
BAIT_APP_PROD_PRIMARY_URL="${primaryConnStr}"
BAIT_APP_PROD_DUPLICATES_URL="${dupConnStr}"
`;
fs.writeFileSync('.env.bait-app-prod.tmp', envContent, 'utf8');
console.log('\nSaved to .env.bait-app-prod.tmp');

// Verify
console.log('\nVerifying primary DB...');
try {
  const s = neon(primaryConnStr);
  const r = await s`SELECT current_user, current_database()`;
  console.log('  ', r[0].current_user, '@', r[0].current_database, '— PASS');
} catch (e) { console.error('  FAILED:', e.message); }

console.log('Verifying duplicates DB...');
try {
  const s = neon(dupConnStr);
  const r = await s`SELECT current_user, current_database()`;
  console.log('  ', r[0].current_user, '@', r[0].current_database, '— PASS');
} catch (e) { console.error('  FAILED:', e.message); }
