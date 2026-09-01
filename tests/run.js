const fs = require('fs');

console.log('Running tests...');
let failed = 0;
let passed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`✅ PASS: ${message}`);
  } else {
    failed++;
    console.error(`❌ FAIL: ${message}`);
  }
}

// 1. Check Cloudflare removal
const hasWrangler = fs.existsSync('wrangler.toml');
const hasWorker = fs.existsSync('worker/index.js');
assert(!hasWrangler, 'STACK CLOUDFLARE REMOVED: No wrangler.toml');
assert(!hasWorker, 'STACK CLOUDFLARE REMOVED: No worker/index.js');

// 2. Check Secrets
const gitignore = fs.existsSync('.gitignore') ? fs.readFileSync('.gitignore', 'utf8') : '';
assert(gitignore.includes('.env'), 'NO SECRETS TRACKED: .gitignore blocks .env');
assert(gitignore.includes('.dev.vars'), 'NO SECRETS TRACKED: .gitignore blocks .dev.vars');

// 3. Check Architecture
assert(fs.existsSync('api/leads.js'), 'VERCEL API STRUCTURE: api/leads.js exists');
assert(fs.existsSync('lib/db.js'), 'VERCEL API STRUCTURE: lib/db.js exists');
assert(fs.existsSync('vercel.json'), 'VERCEL API STRUCTURE: vercel.json exists');

// 4. Validate Logic (Static analysis of code for PII persistence)
const schema = fs.existsSync('db/schema.sql') ? fs.readFileSync('db/schema.sql', 'utf8') : '';
assert(!schema.includes(' nip '), 'NIP NOT PERSISTED: schema does not contain nip column');
const leadsJs = fs.existsSync('api/leads.js') ? fs.readFileSync('api/leads.js', 'utf8') : '';
assert(!leadsJs.includes('nip'), 'NIP NOT PERSISTED: api/leads.js does not use nip');

const validateJs = fs.existsSync('lib/validation.js') ? fs.readFileSync('lib/validation.js', 'utf8') : '';
assert(!validateJs.includes('phoneConfirm') || !schema.includes('phoneConfirm'), 'PHONE CONFIRM NOT PERSISTED: phoneConfirm not in DB');

console.log(`\nTests finished: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
