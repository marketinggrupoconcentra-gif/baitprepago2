import { chromium } from 'playwright';
const BASE = process.env.VERCEL_PREVIEW_URL.replace(/\/$/, '');
const S = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, extraHTTPHeaders: { 'x-vercel-protection-bypass': S } });
const p = await ctx.newPage();
p.on('pageerror', e => console.log('PAGEERROR:', e.message));
await p.goto(`${BASE}/admin`);
await p.fill('input[type="email"]', process.env.QA_ADMIN_EMAIL);
await p.fill('input[type="password"]', process.env.QA_ADMIN_PASSWORD);
await p.click('button[type="submit"]');
await p.waitForURL('**/admin/dashboard');
await p.waitForTimeout(800);

const probe = async (where) => {
  const before = await p.evaluate(() => {
    const s = document.getElementById('sidebar');
    const h = document.getElementById('hamburgerBtn');
    return { hasHamburger: !!h, hamburgerVisible: h ? h.offsetHeight > 0 : false, sidebarOpen: s ? s.classList.contains('open') : null, sidebarX: s ? s.getBoundingClientRect().x : null };
  });
  await p.click('#hamburgerBtn').catch(e => console.log(where, 'click err', e.message));
  await p.waitForTimeout(600);
  const after = await p.evaluate(() => {
    const s = document.getElementById('sidebar');
    return { sidebarOpen: s ? s.classList.contains('open') : null, sidebarX: s ? s.getBoundingClientRect().x : null, leadsLinkInView: (() => { const a = document.querySelector('a[href="/admin/leads"]'); if (!a) return null; const r = a.getBoundingClientRect(); return r.x >= 0 && r.x < window.innerWidth; })() };
  });
  console.log(where, JSON.stringify({ before, after }));
};

await probe('DASHBOARD@390');
// go to leads (open hamburger, click link)
await p.click('#hamburgerBtn').catch(()=>{});
await p.waitForTimeout(400);
await p.click('a[href="/admin/leads"]').catch(async e => { console.log('nav click failed:', e.message); await p.goto(`${BASE}/admin/leads`); });
await p.waitForURL('**/admin/leads');
await p.waitForSelector('#leadsBody tr[data-id]');
await p.waitForTimeout(500);
await probe('LEADS@390');

await b.close();
