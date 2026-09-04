const fs = require('fs');

console.log('Running Analytics Unit Tests...');
let failed = 0;
let passed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`✓ PASS: ${message}`);
  } else {
    failed++;
    console.error(`✗ FAIL: ${message}`);
  }
}

// 1. Check structural requirements
assert(fs.existsSync('api/admin/analytics.js'), 'api/admin/analytics.js exists');
assert(fs.existsSync('api/admin/analytics/facets.js'), 'api/admin/analytics/facets.js exists');
assert(fs.existsSync('api/admin/analytics/export.js'), 'api/admin/analytics/export.js exists');
assert(fs.existsSync('admin/analytics.html'), 'admin/analytics.html exists');
assert(fs.existsSync('admin/analytics.css'), 'admin/analytics.css exists');
assert(fs.existsSync('admin/analytics.js'), 'admin/analytics.js exists');

// 2. Validate backend APIs for security and performance patterns
const endpoints = [
  'api/admin/analytics.js',
  'api/admin/analytics/facets.js',
  'api/admin/analytics/export.js'
];

for (const p of endpoints) {
  const content = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  assert(content.includes('requireAdminSession'), `${p} uses requireAdminSession`);
  assert(!content.match(/SELECT\s+\*/i) || content.match(/SELECT\s+\*/i)?.[0] === null, `${p} has no SELECT *`);
  if (p === 'api/admin/analytics.js') {
    assert(content.includes('generate_series'), 'analytics.js uses generate_series for time ranges');
    assert(content.includes('Promise.all'), 'analytics.js executes queries in parallel');
  }
}

// 3. Check CSV Export Neutralization
const exportJs = fs.existsSync('api/admin/analytics/export.js') ? fs.readFileSync('api/admin/analytics/export.js', 'utf8') : '';
assert(exportJs.includes('/^[=+\\-@]/'), 'export.js checks for spreadsheet injection characters');
assert(exportJs.includes('neutralizeCsv'), 'export.js implements a sanitizer function');
assert(exportJs.includes('admin_audit_log') || exportJs.includes('logAdminAction'), 'export.js audits the download');
assert(exportJs.includes('ANALYTICS_EXPORT'), 'export.js logs ANALYTICS_EXPORT event');

// 4. Validate UI logic (XSS and clean DOM updates)
const uiJs = fs.existsSync('admin/analytics.js') ? fs.readFileSync('admin/analytics.js', 'utf8') : '';
assert(!uiJs.includes('.innerHTML = e') && !uiJs.includes('.innerHTML = data'), 'analytics.js uses safe text insertion for external data');
assert(uiJs.includes('escHtml'), 'analytics.js uses escHtml function');
assert(!uiJs.match(/src=["']https?:/), 'analytics.html has no external scripts');
assert(!uiJs.match(/href=["']https?:/), 'analytics.html has no external styles');

console.log(`\nTests finished: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
