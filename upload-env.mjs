import fs from 'fs';
import { execSync } from 'child_process';

const envContent = fs.readFileSync('.env.local', 'utf-8');
const lines = envContent.split('\n');

for (const line of lines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;

  // Simple parser
  const match = trimmed.match(/^([^=]+)=(.*)$/);
  if (!match) continue;

  const key = match[1].trim();
  let value = match[2].trim();
  
  // Remove wrapping quotes if present
  if (value.startsWith('"') && value.endsWith('"')) {
    value = value.slice(1, -1);
  } else if (value.startsWith("'") && value.endsWith("'")) {
    value = value.slice(1, -1);
  }

  // Skip vercel token
  if (key === 'VERCEL_OIDC_TOKEN') continue;
  
  console.log(`\nUploading ${key}...`);

  // First try to remove it to avoid "already exists" errors
  try {
    execSync(`npx vercel env rm ${key} production -y`, { stdio: 'ignore' });
  } catch (e) {
    // Ignore error if it doesn't exist
  }

  // Add the variable
  try {
    execSync(`npx vercel env add ${key} production`, {
      input: value,
      stdio: ['pipe', 'inherit', 'inherit']
    });
    console.log(`✅ ${key} uploaded successfully.`);
  } catch (e) {
    console.error(`❌ Failed to upload ${key}:`, e.message);
  }
}
