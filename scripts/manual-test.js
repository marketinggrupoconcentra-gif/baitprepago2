import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envPath = path.join(__dirname, '../.env.branch');
const envFile = fs.readFileSync(envPath, 'utf-8');

const env = {};
envFile.split('\n').forEach(line => {
  if (line.includes('=')) {
    const parts = line.split('=');
    const key = parts[0].trim();
    let val = parts.slice(1).join('=').trim();
    if (val.startsWith('"') && val.endsWith('"')) {
      val = val.substring(1, val.length - 1);
    }
    env[key] = val;
  }
});

const baseUrl = 'https://baitprepago2-dcr83fmkr-lid-marketing.vercel.app';
const secret = env.VERCEL_AUTOMATION_BYPASS_SECRET;

async function run() {
  const payload = { email: env.QA_ADMIN_EMAIL, password: env.QA_ADMIN_PASSWORD };
  console.log("Sending payload:", payload);
  
  const res = await fetch(`${baseUrl}/api/admin/login`, {
    method: 'POST',
    headers: {
      'x-vercel-protection-bypass': secret,
      'Content-Type': 'application/json',
      'Origin': baseUrl
    },
    body: JSON.stringify(payload)
  });
  
  console.log("Status:", res.status);
  const text = await res.text();
  console.log("Response:", text);
}

run();
