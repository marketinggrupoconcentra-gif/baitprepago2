const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const BUSINESS_TIME_ZONE = 'America/Mexico_City';

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

test('explicit CDMX formatting is independent from runner timezone', () => {
  // 2026-09-05 04:30 UTC is still 2026-09-04 in Mexico City.
  const instant = new Date('2026-09-05T04:30:00.000Z');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(instant);

  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  assert.equal(`${value.year}-${value.month}-${value.day}`, '2026-09-04');
});

test('lead API uses explicit CDMX civil-day boundaries', () => {
  const source = read('api/admin/leads/index.js');

  assert.match(source, /America\/Mexico_City/);
  assert.match(source, /AT TIME ZONE/);
  assert.match(source, /date \+ 1/);
  assert.doesNotMatch(source, /23:59:59\.999Z/);
  assert.doesNotMatch(source, /Date\.parse\(dateFrom\)/);
  assert.doesNotMatch(source, /Date\.parse\(dateTo\)/);
});

test('admin leads UI renders operational timestamps in CDMX', () => {
  const source = read('assets/admin-leads.js');

  assert.match(source, /const BUSINESS_TIME_ZONE = 'America\/Mexico_City'/);
  const explicitTimeZoneUsages = source.match(/timeZone:\s*BUSINESS_TIME_ZONE/g) || [];
  assert.ok(
    explicitTimeZoneUsages.length >= 3,
    `expected at least 3 explicit CDMX formatters, found ${explicitTimeZoneUsages.length}`
  );
});

test('database source of truth rejects naive business timestamps', () => {
  const sqlFiles = [
    'db/schema.sql',
    'db/migrations/002_admin_auth.sql',
    'db/migrations/003_lead_workflow.sql',
    'db/migrations/004_cdmx_timezone_policy.sql'
  ];

  for (const file of sqlFiles) {
    const source = read(file);
    assert.doesNotMatch(
      source,
      /\bTIMESTAMP\s+WITHOUT\s+TIME\s+ZONE\b/i,
      `${file} must not declare TIMESTAMP WITHOUT TIME ZONE`
    );
  }

  const schema = read('db/schema.sql');
  assert.match(schema, /TIMESTAMPTZ/i);
});
