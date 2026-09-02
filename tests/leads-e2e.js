// tests/leads-e2e.js
const fs = require('fs');
const https = require('https');

console.log('Running leads E2E tests against Preview...');

const PREVIEW_URL = process.env.VERCEL_PREVIEW_URL;
const BYPASS_SECRET = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

if (!PREVIEW_URL) {
  console.log('⚠️ SKIPPED: VERCEL_PREVIEW_URL not set.');
  process.exit(0);
}

if (!BYPASS_SECRET) {
  console.log('⚠️ SKIPPED: VERCEL_AUTOMATION_BYPASS_SECRET not set.');
  process.exit(0);
}

const url = new URL('/api/admin/leads', PREVIEW_URL);
url.searchParams.set('limit', '5');

const options = {
  headers: {
    'x-vercel-protection-bypass': BYPASS_SECRET
  }
};

const req = https.get(url, options, (res) => {
  console.log(`Response Status: ${res.statusCode}`);
  
  // We expect 401 Unauthorized because we haven't provided a valid admin session cookie.
  // This validates the auth guard is working on the Preview deployment!
  if (res.statusCode === 401) {
    console.log('✅ PASS: API is protected and returned 401 Unauthorized.');
    process.exit(0);
  } else {
    console.error(`❌ FAIL: Expected 401, got ${res.statusCode}`);
    process.exit(1);
  }
});

req.on('error', (e) => {
  console.error(`❌ FAIL: Request error - ${e.message}`);
  process.exit(1);
});
