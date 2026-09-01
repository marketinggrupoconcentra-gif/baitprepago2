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

console.log(`\nTests finished: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
