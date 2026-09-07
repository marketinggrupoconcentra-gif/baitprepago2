/**
 * Configure Vercel Production environment variables.
 * Reads credentials from temp file and sets them via vercel CLI.
 */
import { execSync } from 'child_process';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
const tmpEnv = dotenv.parse(fs.readFileSync('.env.bait-app-prod.tmp', 'utf8'));

const primaryUrl = tmpEnv.BAIT_APP_PROD_PRIMARY_URL;
const dupUrl = tmpEnv.BAIT_APP_PROD_DUPLICATES_URL;

function setEnvVar(name, value, environments) {
  const envFlags = environments.map(e => `--environment=${e}`).join(' ');
  
  // First remove if exists, then add
  try {
    execSync(`vercel env rm ${name} production --yes 2>&1`, { stdio: 'pipe' });
  } catch (_) { /* ok if not exists */ }
  
  // Write value via stdin to avoid shell visibility
  const result = execSync(
    `vercel env add ${name} production`,
    { input: value, stdio: ['pipe', 'pipe', 'pipe'] }
  );
  console.log(`SET ${name}: OK`);
}

function setEnvVarSimple(name, value) {
  try {
    execSync(`vercel env rm ${name} production --yes 2>&1`, { stdio: 'pipe' });
  } catch (_) {}
  
  execSync(`vercel env add ${name} production`, {
    input: value,
    stdio: ['pipe', 'pipe', 'pipe']
  });
  console.log(`SET ${name}: OK`);
}

console.log('=== CONFIGURING VERCEL PRODUCTION ENV VARS ===\n');

// 1. DUPLICATES_DATABASE_URL  
setEnvVarSimple('DUPLICATES_DATABASE_URL', dupUrl);

// 2. Identity variables
setEnvVarSimple('EXPECTED_NEON_BRANCH_ID', 'br-lingering-sun-avyoux4u');
setEnvVarSimple('EXPECTED_NEON_ENDPOINT_ID', 'ep-square-recipe-avlk7lu1');
setEnvVarSimple('EXPECTED_DUPLICATES_NEON_ENDPOINT_ID', 'ep-square-recipe-avlk7lu1');
setEnvVarSimple('EXPECTED_DUPLICATES_DATABASE_NAME', 'baitprepago_duplicates');

// 3. App settings
setEnvVarSimple('APP_BASE_URL', 'https://baitprepago2.vercel.app');
setEnvVarSimple('EMAIL_MODE', 'disabled');

console.log('\n=== DONE ===');
console.log('\nIMPORTANT: DATABASE_URL must also be updated to use bait_app_prod.');
console.log('The current DATABASE_URL may still use neondb_owner.');
