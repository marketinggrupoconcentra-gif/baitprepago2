import { execSync } from 'child_process';
import fs from 'fs';

/**
 * Sube las variables de .env.production.vercel a Vercel Production.
 * Las variables marcadas como sensibles se suben con --sensitive (encriptadas,
 * no visibles en el dashboard de Vercel).
 */

const SENSITIVE_KEYS = new Set([
  'APP_DATABASE_URL',
  'PII_ENCRYPTION_KEY',
  'PII_BLIND_INDEX_KEY',
  'IP_HASH_KEY',
  'CAPTCHA_PEPPER',
  'CLICK_ID_SECRET',
  'CRON_SECRET',
  'NEON_AUTH_COOKIE_SECRET',
  'BREVO_API_KEY',
]);

const envContent = fs.readFileSync('.env.production.vercel', 'utf-8');
const lines = envContent.split('\n');

for (const line of lines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;

  const match = trimmed.match(/^([^=]+)=(.*)$/);
  if (!match) continue;

  const key = match[1].trim();
  let value = match[2].trim();

  // Remove wrapping quotes
  if (value.startsWith('"') && value.endsWith('"')) {
    value = value.slice(1, -1);
  } else if (value.startsWith("'") && value.endsWith("'")) {
    value = value.slice(1, -1);
  }

  // Skip empty values (pending credentials)
  if (!value) {
    console.log(`⏭️  ${key} — vacío, omitido.`);
    continue;
  }

  const isSensitive = SENSITIVE_KEYS.has(key);
  const sensitiveFlag = isSensitive ? ' --sensitive' : '';

  console.log(`\n📤 ${key}${isSensitive ? ' 🔒 (encrypted)' : ''}...`);

  // Remove existing to avoid "already exists" errors
  try {
    execSync(`npx vercel env rm ${key} production -y`, { stdio: 'ignore' });
  } catch {
    // Ignore — may not exist yet
  }

  // Add the variable
  try {
    execSync(`npx vercel env add ${key} production${sensitiveFlag}`, {
      input: value,
      stdio: ['pipe', 'inherit', 'inherit'],
    });
    console.log(`✅ ${key} uploaded${isSensitive ? ' (encrypted/hidden)' : ''}.`);
  } catch (e) {
    console.error(`❌ Failed: ${key}:`, e.message);
  }
}

console.log('\n🚀 Todas las variables de producción subidas. Haz un redeploy para aplicarlas.');
