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

// 5. Stage 1B — Session guard + Overview API
assert(fs.existsSync('lib/admin-session.js'), 'STAGE 1B: lib/admin-session.js exists');
assert(fs.existsSync('api/admin/overview.js'), 'STAGE 1B: api/admin/overview.js exists');
assert(fs.existsSync('api/admin/session.js'), 'STAGE 1B: api/admin/session.js exists');

const sessionGuard = fs.existsSync('lib/admin-session.js') ? fs.readFileSync('lib/admin-session.js', 'utf8') : '';
assert(sessionGuard.includes('requireAdminSession'), 'STAGE 1B: requireAdminSession exported from guard');

const overviewJs = fs.existsSync('api/admin/overview.js') ? fs.readFileSync('api/admin/overview.js', 'utf8') : '';
assert(overviewJs.includes('requireAdminSession'), 'STAGE 1B: overview uses session guard');
assert(!overviewJs.match(/SELECT\s+\*/m) || overviewJs.match(/SELECT\s+\*/m)?.[0] === null, 'STAGE 1B: overview has no SELECT *');
assert(overviewJs.includes('Promise.all'), 'STAGE 1B: overview uses parallel queries');
assert(!overviewJs.includes("'phone'") && !overviewJs.includes('"phone"'), 'STAGE 1B: overview does not expose phone field');

// 6. Stage 1B — Dashboard UI
const dashboardHtml = fs.existsSync('admin/dashboard.html') ? fs.readFileSync('admin/dashboard.html', 'utf8') : '';
assert(!dashboardHtml.includes('siguiente etapa'), 'DASHBOARD: placeholder removed');
assert(dashboardHtml.includes('kpiGrid'), 'DASHBOARD: KPI grid element');
assert(dashboardHtml.includes('trendChartWrap'), 'DASHBOARD: trend chart element');
assert(dashboardHtml.includes('sourcesList'), 'DASHBOARD: sources list element');
assert(dashboardHtml.includes('campaignList'), 'DASHBOARD: campaign list element');
assert(dashboardHtml.includes('activityBody'), 'DASHBOARD: activity table body');
assert(dashboardHtml.includes('rangeSelect'), 'DASHBOARD: range selector');
assert(dashboardHtml.includes('logoutBtn'), 'DASHBOARD: logout button');
assert(dashboardHtml.includes('sidebar'), 'DASHBOARD: sidebar present');
assert(!dashboardHtml.match(/src=["']https?:/), 'DASHBOARD: no external scripts');
assert(!dashboardHtml.match(/href=["']https?:/), 'DASHBOARD: no external styles');
assert(!dashboardHtml.match(/\bon(click|submit|load|change|input|focus|blur|keydown|keyup|keypress|mouseenter|mouseleave|mouseover|mouseout|dblclick|contextmenu|error|reset|select|scroll)=/i), 'DASHBOARD: no inline event handlers');

const dashboardJs = fs.existsSync('admin/dashboard.js') ? fs.readFileSync('admin/dashboard.js', 'utf8') : '';
assert(dashboardJs.includes('clearDashboardDOM'), 'DASHBOARD: DOM cleared on logout');
assert(!dashboardJs.match(/[^/]localStorage\./), 'DASHBOARD: no localStorage usage');
assert(!dashboardJs.match(/[^/]sessionStorage\./), 'DASHBOARD: no sessionStorage usage');
assert(dashboardJs.includes('Intl.DateTimeFormat'), 'DASHBOARD: uses Intl for dates');
assert(dashboardJs.includes('America/Mexico_City'), 'DASHBOARD: uses correct timezone');

// 7. Migration 002 — Production Safety (additive, idempotent)
const migration002Raw = fs.existsSync('db/migrations/002_admin_auth.sql')
  ? fs.readFileSync('db/migrations/002_admin_auth.sql', 'utf8')
  : '';
const migration002 = migration002Raw
  .split('\n')
  .filter(l => !l.trim().startsWith('--'))
  .join('\n');

assert(!migration002.match(/\bDROP\s+TABLE\b/i),       'MIGRATION 002: No DROP TABLE');
assert(!migration002.match(/\bDROP\s+INDEX\b/i),        'MIGRATION 002: No DROP INDEX');
assert(!migration002.match(/\bDROP\s+CONSTRAINT\b/i),   'MIGRATION 002: No DROP CONSTRAINT');
assert(!migration002.match(/\bTRUNCATE\b/i),             'MIGRATION 002: No TRUNCATE');
assert(!migration002.match(/^DROP.*CASCADE/im),          'MIGRATION 002: No bare CASCADE DDL');
assert(migration002Raw.match(/CREATE TABLE IF NOT EXISTS/i), 'MIGRATION 002: Uses CREATE TABLE IF NOT EXISTS');
assert(migration002Raw.match(/CREATE INDEX IF NOT EXISTS/i), 'MIGRATION 002: Uses CREATE INDEX IF NOT EXISTS');
assert(!migration002Raw.match(/br-[a-z0-9\-]{10,}/),    'MIGRATION 002: No hardcoded branch IDs');
assert(!migration002Raw.match(/Preview Only|DO NOT run on Production/i), 'MIGRATION 002: No preview-only restriction comments');

// 8. Stage 1C — Admin Leads Module Security & Static Analysis
const endpointPaths = [
  'api/admin/leads/index.js',
  'api/admin/leads/detail.js',
  'api/admin/leads/facets.js',
  'api/admin/leads/search.js',
  'api/admin/leads/reveal-phone.js'
];
for (const p of endpointPaths) {
  const content = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  assert(!content.includes("runtime: 'edge'"), `STAGE 1C: ${p} does not use edge runtime`);
  assert(!content.includes('getAdminSession'), `STAGE 1C: ${p} does not use getAdminSession`);
  assert(content.includes('requireAdminSession'), `STAGE 1C: ${p} uses requireAdminSession`);
  assert(!content.match(/new\s+neon\(/), `STAGE 1C: ${p} does not instantiate new neon()`);
  assert(!content.match(/SELECT\s+\*/i) || content.match(/SELECT\s+\*/i)?.[0] === null, `STAGE 1C: ${p} has no SELECT *`);
}

const detailJs = fs.existsSync('api/admin/leads/detail.js') ? fs.readFileSync('api/admin/leads/detail.js', 'utf8') : '';
assert(!detailJs.includes('user_agent'), 'STAGE 1C: detail.js does not expose user_agent');
assert(!detailJs.includes('fbclid'), 'STAGE 1C: detail.js does not expose fbclid');

const auditJs = fs.existsSync('lib/admin-audit.js') ? fs.readFileSync('lib/admin-audit.js', 'utf8') : '';
assert(auditJs.includes("['phone', 'ip', 'user_agent', 'ip_address']"), 'STAGE 1C: admin-audit.js strictly forbids raw phone and ip');
assert(auditJs.includes('hashIdentity'), 'STAGE 1C: admin-audit.js uses hashIdentity for actor_hash');

console.log(`\nTests finished: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
