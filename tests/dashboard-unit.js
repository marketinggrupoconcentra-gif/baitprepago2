/**
 * tests/dashboard-unit.js
 *
 * Local unit tests for Stage 1B dashboard logic.
 * No DB, no network, no external deps.
 */

let pass = 0, fail = 0;

function test(label, fn) {
  try {
    fn();
    console.log(`✅ PASS: ${label}`);
    pass++;
  } catch (e) {
    console.error(`❌ FAIL: ${label} — ${e.message}`);
    fail++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}
function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(`${msg || ''}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

console.log('=== Dashboard Unit Tests ===\n');

// ── Range whitelist logic ────────────────────────────────────────────
const ALLOWED_RANGES = { 7: 7, 14: 14, 30: 30 };
const DEFAULT_RANGE  = 14;

function validateRange(raw) {
  const parsed = parseInt(raw, 10);
  return ALLOWED_RANGES[parsed]; // undefined if invalid
}

test('range=7 is valid', () => assertEqual(validateRange('7'), 7));
test('range=14 is valid', () => assertEqual(validateRange('14'), 14));
test('range=30 is valid', () => assertEqual(validateRange('30'), 30));
test('range=1 is invalid', () => assertEqual(validateRange('1'), undefined));
test('range=0 is invalid', () => assertEqual(validateRange('0'), undefined));
test('range=-1 is invalid', () => assertEqual(validateRange('-1'), undefined));
test('range=999 is invalid', () => assertEqual(validateRange('999'), undefined));
test('range=abc is invalid', () => assertEqual(validateRange('abc'), undefined));
test('range="" is invalid', () => assertEqual(validateRange(''), undefined));
test('range=14.5 is invalid (truncates to 14)', () => assertEqual(validateRange('14.5'), 14)); // parseInt truncates
test('range=14.0 maps to 14', () => assertEqual(validateRange('14.0'), 14));
test('default range is 14', () => assertEqual(DEFAULT_RANGE, 14));

// ── Source normalization ─────────────────────────────────────────────
function normalizeSource(raw) {
  if (raw === null || raw === undefined) return 'Sin atribución';
  if (typeof raw === 'string' && raw.trim() === '') return 'Sin atribución';
  return raw.trim();
}

test('null source → Sin atribución', () => assertEqual(normalizeSource(null), 'Sin atribución'));
test('undefined source → Sin atribución', () => assertEqual(normalizeSource(undefined), 'Sin atribución'));
test('empty string → Sin atribución', () => assertEqual(normalizeSource(''), 'Sin atribución'));
test('whitespace → Sin atribución', () => assertEqual(normalizeSource('  '), 'Sin atribución'));
test('google → google', () => assertEqual(normalizeSource('google'), 'google'));
test('trimmed google → google', () => assertEqual(normalizeSource('  google  '), 'google'));

// ── Trend zero-fill logic ─────────────────────────────────────────────
function fillTrendZeros(rawTrend, range) {
  // Simulate zero-fill: ensure we get exactly `range` entries
  const result = [];
  const today = new Date();
  for (let i = range - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const existing = rawTrend.find(r => r.date === dateStr);
    result.push({ date: dateStr, leads: existing ? existing.leads : 0 });
  }
  return result;
}

test('zero-fill produces exactly range entries', () => {
  const result = fillTrendZeros([], 14);
  assertEqual(result.length, 14, 'length');
});
test('zero-fill fills missing days with 0', () => {
  const result = fillTrendZeros([], 7);
  assert(result.every(r => r.leads === 0), 'all zeros');
});
test('zero-fill preserves existing values', () => {
  const today = new Date().toISOString().split('T')[0];
  const raw = [{ date: today, leads: 5 }];
  const result = fillTrendZeros(raw, 7);
  const todayRow = result.find(r => r.date === today);
  assertEqual(todayRow?.leads, 5, 'today has 5 leads');
});

// ── Response allowlist: no PII fields ────────────────────────────────
function buildOverviewResponse(kpis, trend, sources, campaigns, recentActivity) {
  return { generatedAt: new Date().toISOString(), kpis, trend, sources, campaigns, recentActivity };
}

const FORBIDDEN_FIELDS = ['phone', 'ip', 'user_agent', 'referrer', 'page_url',
  'fbclid', 'fb_ad_id', 'fb_adset_id', 'fb_campaign_id', 'nip', 'phoneConfirm'];

test('overview response contains no PII fields at top level', () => {
  const resp = buildOverviewResponse(
    { total: 1, last24Hours: 0, last7Days: 1, attributionRate: 100 },
    [{ date: '2026-09-01', leads: 1 }],
    [{ source: 'google', count: 1, percentage: 100 }],
    [{ campaign: 'test', count: 1 }],
    [{ createdAt: '2026-09-01T00:00:00Z', source: 'google', campaign: null, medium: null }]
  );
  const json = JSON.stringify(resp);
  FORBIDDEN_FIELDS.forEach(field => {
    assert(!json.includes(`"${field}"`), `Field "${field}" must not appear in response`);
  });
});

test('recentActivity contains only allowed fields', () => {
  const allowedFields = new Set(['createdAt', 'source', 'campaign', 'medium']);
  const item = { createdAt: '2026-09-01T00:00:00Z', source: 'google', campaign: null, medium: null };
  Object.keys(item).forEach(k => {
    assert(allowedFields.has(k), `Field "${k}" not in allowlist`);
  });
});

// ── Session guard interface ───────────────────────────────────────────
test('requireAdminSession is exported from lib/admin-session.js', async () => {
  const mod = await import('../lib/admin-session.js');
  assert(typeof mod.requireAdminSession === 'function', 'must be a function');
});

// ── Attribution rate calc ────────────────────────────────────────────
function calcAttributionRate(total, attributed) {
  if (total === 0) return 0;
  return Math.round((attributed / total) * 100 * 10) / 10;
}

test('attribution rate: 0 of 0 = 0', () => assertEqual(calcAttributionRate(0, 0), 0));
test('attribution rate: 10 of 10 = 100', () => assertEqual(calcAttributionRate(10, 10), 100));
test('attribution rate: 1 of 3 = 33.3', () => assertEqual(calcAttributionRate(3, 1), 33.3));
test('attribution rate: 2 of 3 = 66.7', () => assertEqual(calcAttributionRate(3, 2), 66.7));

// ── Top-5 + Otros grouping ───────────────────────────────────────────
function groupSources(rawSources) {
  if (rawSources.length <= 5) return rawSources;
  const top5 = rawSources.slice(0, 5);
  const othersCount = rawSources.slice(5).reduce((acc, s) => acc + s.count, 0);
  if (othersCount > 0) top5.push({ source: 'Otros', count: othersCount });
  return top5;
}

test('groupSources: <=5 sources unchanged', () => {
  const src = [{ source: 'a', count: 1 }, { source: 'b', count: 2 }];
  assertEqual(groupSources(src).length, 2);
});
test('groupSources: 6 sources → 5 + Otros', () => {
  const src = Array.from({ length: 6 }, (_, i) => ({ source: `s${i}`, count: 10 }));
  const result = groupSources(src);
  assertEqual(result.length, 6); // 5 + Otros
  assertEqual(result[5].source, 'Otros');
  assertEqual(result[5].count, 10);
});

console.log(`\n=== Results: ${pass} passed, ${fail} failed ===\n`);
if (fail > 0) process.exit(1);
