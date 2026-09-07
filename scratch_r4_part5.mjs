import { neon } from '@neondatabase/serverless';
const BASE = process.env.VERCEL_PREVIEW_URL.replace(/\/$/, '');
const H = { 'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET, origin: BASE };
const sql = neon(process.env.DATABASE_URL);

const phone = '55' + String(Math.floor(10000000 + Math.random() * 89999999)); // 10 digits, synthetic
const nip = String(Math.floor(1000 + Math.random() * 8999));

const before = (await sql`select count(*)::int n from leads where utm_source='QA_R4_DB_TARGET'`)[0].n;
console.log('QA_R4_DB_TARGET before:', before);

const res = await fetch(BASE + '/api/leads', {
  method: 'POST',
  headers: { ...H, 'Content-Type': 'application/json' },
  body: JSON.stringify({ phone, nip, utm_source: 'QA_R4_DB_TARGET', utm_medium: 'qa', utm_campaign: 'stage1d-r4' })
});
const json = await res.json().catch(() => ({}));
console.log('POST /api/leads ->', res.status, JSON.stringify(json));
console.log('  expect: 201 ok:true saved:true =>',
  res.status === 201 && json.ok === true && json.saved === true ? 'PASS' : 'FAIL');

await new Promise(r => setTimeout(r, 1000));

const rows = await sql`select id, phone, utm_source, utm_medium, status, status_version from leads where utm_source='QA_R4_DB_TARGET'`;
console.log('preview QA_R4_DB_TARGET count:', rows.length, '(expect 1)');
if (rows.length === 1) {
  const r = rows[0];
  console.log('  row: phone_matches_synthetic=' + (r.phone === phone) + ' status=' + r.status + ' version=' + r.status_version);
}

// schema recheck
const cols = (await sql`select column_name from information_schema.columns where table_name='leads'`).map(c => c.column_name);
console.log('schema: nip/phoneConfirm/phone_confirm absent =>',
  !cols.includes('nip') && !cols.includes('phoneConfirm') && !cols.includes('phone_confirm') ? 'PASS' : 'FAIL');

// cleanup
const del = await sql`delete from leads where utm_source='QA_R4_DB_TARGET' returning id`;
console.log('cleanup deleted rows:', del.length);
const after = (await sql`select count(*)::int n from leads where utm_source='QA_R4_DB_TARGET'`)[0].n;
console.log('QA_R4_DB_TARGET after cleanup:', after, after === 0 ? '=> PASS' : '=> FAIL');
