import { chromium } from 'playwright';
const BASE = process.env.VERCEL_PREVIEW_URL.replace(/\/$/, '');
const S = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const b = await chromium.launch();
const ctx = await b.newContext({ extraHTTPHeaders: { 'x-vercel-protection-bypass': S } });
const p = await ctx.newPage();
p.on('pageerror', e => console.log('PAGEERROR:', e.message));
p.on('console', m => { if (m.type() === 'error' && !m.text().includes('inline style') && !m.text().includes('frame-ancestors')) console.log('CONSOLE_ERR:', m.text()); });
p.on('response', r => { if (r.url().includes('/api/')) console.log('API', r.status(), r.url().replace(BASE,'')); });

// login
await p.goto(`${BASE}/admin`);
await p.fill('input[type="email"]', process.env.QA_ADMIN_EMAIL);
await p.fill('input[type="password"]', process.env.QA_ADMIN_PASSWORD);
await p.click('button[type="submit"]');
await p.waitForURL('**/admin/dashboard');

console.log('=== direct nav to /admin/leads ===');
await p.goto(`${BASE}/admin/leads`);
await p.waitForTimeout(6000);
console.log('readyState:', await p.evaluate(() => document.readyState));
console.log('scripts:', await p.evaluate(() => [...document.scripts].map(s => s.src || '(inline)')));
console.log('rows:', await p.locator('#leadsBody tr[data-id]').count());
console.log('leadsBody:', JSON.stringify((await p.innerHTML('#leadsBody')).trim().slice(0,300)));
// try to see if a global from admin-leads is defined
console.log('has openLeadDrawer?', await p.evaluate(() => typeof window.openLeadDrawer));
await b.close();
