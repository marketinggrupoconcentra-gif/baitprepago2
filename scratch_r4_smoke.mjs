// Part 3 (identity via HTTP) + Part 4 (auth smoke) — no credentials printed
const BASE = process.env.VERCEL_PREVIEW_URL.replace(/\/$/, '');
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const H = { 'x-vercel-protection-bypass': BYPASS, origin: BASE };

function line(k, v) { console.log(k.padEnd(28), v); }

const root = await fetch(BASE + '/', { headers: H });
line('GET / status', root.status);
line('x-vercel-id', root.headers.get('x-vercel-id'));
line('x-matched-path', root.headers.get('x-matched-path'));
line('server', root.headers.get('server'));
line('x-vercel-cache', root.headers.get('x-vercel-cache'));

// SMOKE 1: invalid JSON -> 400
const s1 = await fetch(BASE + '/api/admin/login', {
  method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: '{not-json'
});
line('SMOKE1 invalid JSON', s1.status + ' (expect 400)');

// SMOKE 2: bad credentials -> 401
const s2 = await fetch(BASE + '/api/admin/login', {
  method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'nobody-' + Date.now() + '@example.com', password: 'wrong-pass-xyz' })
});
line('SMOKE2 bad credentials', s2.status + ' (expect 401)');

// SMOKE 3: valid QA SUPER_ADMIN -> 200
const s3 = await fetch(BASE + '/api/admin/login', {
  method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: process.env.QA_ADMIN_EMAIL, password: process.env.QA_ADMIN_PASSWORD })
});
line('SMOKE3 valid admin', s3.status + ' (expect 200)');
const sc = s3.headers.get('set-cookie') || '';
line('SMOKE3 sets session cookie', /bait_admin_session=/.test(sc));

const seq = `${s1.status} / ${s2.status} / ${s3.status}`;
line('AUTH SMOKE SEQUENCE', seq);
console.log(seq === '400 / 401 / 200' ? '\nAUTH SMOKE: PASS' : '\nAUTH SMOKE: FAIL');
