import { chromium } from 'playwright';
const BASE = process.env.VERCEL_PREVIEW_URL.replace(/\/$/, '');
const S = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const b = await chromium.launch();
const p = await b.newContext({ viewport: { width: 390, height: 844 }, extraHTTPHeaders: { 'x-vercel-protection-bypass': S } }).then(c=>c.newPage());
await p.goto(`${BASE}/admin`);
await p.fill('input[type="email"]', process.env.QA_ADMIN_EMAIL);
await p.fill('input[type="password"]', process.env.QA_ADMIN_PASSWORD);
await p.click('button[type="submit"]');
await p.waitForURL('**/admin/dashboard');
await p.goto(`${BASE}/admin/leads`);
await p.waitForSelector('#leadsBody tr[data-id]');
await p.click('#hamburgerBtn');
for (const t of [0, 200, 500, 1000]) {
  await p.waitForTimeout(t === 0 ? 0 : t - (t===200?0:0));
}
await p.waitForTimeout(1200);
const s = await p.evaluate(() => {
  const el = document.getElementById('sidebar');
  const cs = getComputedStyle(el);
  return { x: el.getBoundingClientRect().x, transform: cs.transform, transition: cs.transition, hasOpen: el.classList.contains('open'), position: cs.position, mq: window.matchMedia('(max-width: 767px)').matches };
});
console.log(JSON.stringify(s, null, 1));
// what rule sets the transform?
const rules = await p.evaluate(() => {
  const out = [];
  for (const ss of document.styleSheets) {
    let r; try { r = ss.cssRules; } catch { continue; }
    for (const rule of r) {
      if (rule.cssText && /\.sidebar/.test(rule.cssText) && /transform|translate/.test(rule.cssText)) out.push(rule.cssText.slice(0,200));
      if (rule.cssRules) for (const nr of rule.cssRules) if (nr.cssText && /\.sidebar/.test(nr.cssText) && /transform|translate/.test(nr.cssText)) out.push('@media: ' + nr.cssText.slice(0,200));
    }
  }
  return out;
});
console.log(rules.join('\n'));
await b.close();
