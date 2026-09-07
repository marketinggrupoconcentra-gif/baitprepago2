import { chromium } from 'playwright';
const BASE = process.env.VERCEL_PREVIEW_URL.replace(/\/$/, '');
const S = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const b = await chromium.launch();
const p = await b.newContext({ extraHTTPHeaders: { 'x-vercel-protection-bypass': S } }).then(c=>c.newPage());
p.on('pageerror', e => console.log('PAGEERROR:', e.message));
await p.goto(`${BASE}/admin`);
await p.fill('input[type="email"]', process.env.QA_ADMIN_EMAIL);
await p.fill('input[type="password"]', process.env.QA_ADMIN_PASSWORD);
await p.click('button[type="submit"]');
await p.waitForURL('**/admin/dashboard');
await p.goto(`${BASE}/admin/leads`);
await p.waitForSelector('#leadsBody tr[data-id]', { state: 'attached' });
await p.waitForTimeout(2000);
const info = await p.evaluate(() => {
  const q = s => { const e = document.querySelector(s); if (!e) return null; const c = getComputedStyle(e); const r = e.getBoundingClientRect(); return { display: c.display, visibility: c.visibility, opacity: c.opacity, w: r.width, h: r.height }; };
  return {
    app: q('#app'), appLoader: q('#appLoader'), pageBody: q('#pageBody'),
    table: q('#leadsTable'), wrap: q('.activity-table-wrap'), body: q('#leadsBody'),
    firstRow: q('#leadsBody tr[data-id]'),
    firstBtn: q('#leadsBody tr[data-id] button.view-lead-btn'),
    rowCount: document.querySelectorAll('#leadsBody tr[data-id]').length
  };
});
console.log(JSON.stringify(info, null, 1));
await b.close();
