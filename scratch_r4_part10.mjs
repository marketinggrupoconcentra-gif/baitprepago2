import { chromium } from 'playwright';
import { neon } from '@neondatabase/serverless';
import { mkdirSync } from 'fs';
import assert from 'assert';

const BASE = process.env.VERCEL_PREVIEW_URL.replace(/\/$/, '');
const S = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const sql = neon(process.env.DATABASE_URL);
const OUT = process.argv[2] || './r4-shots';
mkdirSync(OUT, { recursive: true });

const WIDTHS = [ ['1440', 1440, 900], ['768', 768, 1024], ['390', 390, 844] ];
const RUN_ID = 'TEST_R4_BROWSER_QA10_' + Date.now();

const seed = (o = {}) => sql`
  INSERT INTO leads (phone, utm_source, utm_medium, utm_campaign, page_url, referrer, status, status_version)
  VALUES (${o.phone || '5551230000'}, ${RUN_ID}, 'qa', 'stage1d-r4-qa10', 'https://example.com/p', 'https://example.com',
          ${o.status || 'NEW'}, ${o.version || 1}) RETURNING id`.then(r => r[0].id);

const shot = async (page, name) => { await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false }); console.log('  shot', name); };

// On mobile the sidebar is off-canvas; open it via the hamburger before clicking a nav link.
const navClick = async (page, selector, mobile) => {
  if (mobile) {
    await page.waitForSelector('#hamburgerBtn', { state: 'visible' });
    await page.$eval('#hamburgerBtn', el => el.click());
    await page.waitForFunction(() => {
      const s = document.getElementById('sidebar');
      return s.classList.contains('open') && s.getBoundingClientRect().x > -5;
    }, { timeout: 8000 }).catch(async () => {
      // one retry
      await page.$eval('#hamburgerBtn', el => el.click());
      await page.waitForFunction(() => document.getElementById('sidebar').getBoundingClientRect().x > -5, { timeout: 8000 });
    });
  }
  await page.click(selector);
};

const browser = await chromium.launch();
let leadId, lead409;
try {
  leadId = await seed({ phone: '5557770001' });
  lead409 = await seed({ phone: '5557770002' });

  for (const [tag, w, h] of WIDTHS) {
    const mobile = w <= 767;
    console.log(`[${tag}px]${mobile ? ' (mobile)' : ''}`);
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, extraHTTPHeaders: { 'x-vercel-protection-bypass': S } });
    const page = await ctx.newPage();

    // Admin login
    await page.goto(`${BASE}/admin`);
    await page.waitForSelector('#loginForm');
    await shot(page, `${tag}-01-login`);

    await page.fill('input[type="email"]', process.env.QA_ADMIN_EMAIL);
    await page.fill('input[type="password"]', process.env.QA_ADMIN_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/admin/dashboard');
    await page.waitForTimeout(1200);
    await shot(page, `${tag}-02-dashboard`);

    // Leads list
    await navClick(page, 'a[href="/admin/leads"]', mobile);
    await page.waitForURL('**/admin/leads');
    await page.waitForSelector('#leadsBody tr[data-id]');
    await page.waitForTimeout(500);
    await shot(page, `${tag}-03-leads-list`);

    // Part 10 explicit: open + close the Leads sidebar on mobile, verify nav + logout reachable
    if (mobile) {
      await page.click('#hamburgerBtn');
      // wait for the slide-in transition to settle
      await page.waitForFunction(() => document.getElementById('sidebar').getBoundingClientRect().x === 0);
      const openState = await page.evaluate(() => {
        const inView = (sel) => { const e = document.querySelector(sel); if (!e) return false; const r = e.getBoundingClientRect(); return r.x >= 0 && r.right <= window.innerWidth && r.width > 0; };
        return {
          sidebarX: document.getElementById('sidebar').getBoundingClientRect().x,
          overlayShown: document.getElementById('sidebarOverlay').classList.contains('show'),
          ariaExpanded: document.getElementById('hamburgerBtn').getAttribute('aria-expanded'),
          navLeads: inView('a[href="/admin/leads"]'),
          navDash: inView('a[href="/admin/dashboard"]'),
          logout: inView('#logoutBtn')
        };
      });
      assert.strictEqual(openState.sidebarX, 0, '390: leads sidebar must slide fully in');
      assert.ok(openState.overlayShown, '390: overlay shown when sidebar open');
      assert.strictEqual(openState.ariaExpanded, 'true', '390: hamburger aria-expanded=true');
      assert.ok(openState.navLeads && openState.navDash && openState.logout, '390: nav links + logout reachable when sidebar open');
      await shot(page, `${tag}-03b-leads-sidebar-open`);

      // close via the dimmed overlay area beside the panel (x beyond the 240px sidebar)
      await page.mouse.click(320, 400);
      await page.waitForFunction(() => document.getElementById('sidebar').getBoundingClientRect().x < 0
        && !document.getElementById('sidebar').classList.contains('open'));
      const closeState = await page.evaluate(() => ({
        sidebarX: document.getElementById('sidebar').getBoundingClientRect().x,
        overlayShown: document.getElementById('sidebarOverlay').classList.contains('show'),
        ariaExpanded: document.getElementById('hamburgerBtn').getAttribute('aria-expanded')
      }));
      assert.ok(closeState.sidebarX < 0, '390: leads sidebar must slide back off-canvas on close');
      assert.ok(!closeState.overlayShown, '390: overlay hidden after close');
      assert.strictEqual(closeState.ariaExpanded, 'false', '390: hamburger aria-expanded=false after close');
      console.log('    390 Leads sidebar: open + close + nav/logout reachable — OK');
    }

    // Lead drawer
    await page.click(`tr[data-id="${leadId}"] button.view-lead-btn`);
    await page.waitForSelector('#drawerContent', { state: 'visible' });
    await page.waitForTimeout(400);
    await shot(page, `${tag}-04-lead-drawer`);

    // Terminal confirmation modal
    await page.selectOption('#statusSelect', 'REJECTED');
    await page.waitForSelector('#reasonSelect', { state: 'visible' });
    await page.selectOption('#reasonSelect', 'INVALID_DATA');
    await page.click('#btnSaveStatus');
    await page.waitForSelector('#statusConfirmModal', { state: 'visible' });
    await shot(page, `${tag}-05-terminal-confirm`);
    await page.click('#btnCancelStatus');
    await page.waitForSelector('#statusConfirmModal', { state: 'hidden' });
    await page.click('#btnCloseDrawer');
    await page.waitForSelector('#leadDrawer[aria-hidden="true"]');
    await page.waitForTimeout(300);

    // 409 conflict message (reset target to a clean v1 for this width)
    await sql`UPDATE leads SET status='NEW', status_reason=NULL, status_version=1 WHERE id=${lead409}`;
    await page.reload();
    await page.waitForSelector('#leadsBody tr[data-id]');
    await page.click(`tr[data-id="${lead409}"] button.view-lead-btn`);
    await page.waitForSelector('#drawerContent', { state: 'visible' });
    const bg409 = await page.evaluate(async (id) => {
      const r = await fetch('/api/admin/leads/status', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: 'CONTACTED', expectedVersion: 1 }) });
      return r.status;
    }, lead409);
    if (bg409 !== 200) throw new Error('bg 409 setup failed: ' + bg409);
    await page.selectOption('#statusSelect', 'VALIDATED');
    const [c409] = await Promise.all([
      page.waitForResponse(r => r.url().includes('/api/admin/leads/status') && r.request().method() === 'PATCH'),
      page.click('#btnSaveStatus')
    ]);
    if (c409.status() !== 409) throw new Error('expected 409, got ' + c409.status());
    await page.waitForSelector('.conflict-message', { state: 'visible' });
    await page.waitForTimeout(300);
    await shot(page, `${tag}-06-conflict-409`);
    await page.click('#btnCloseDrawer');
    await page.waitForSelector('#leadDrawer[aria-hidden="true"]');
    await page.waitForTimeout(300);

    // VIEWER read-only
    await navClick(page, '#logoutBtn', mobile);
    await page.waitForURL(/\/admin\/?$/);
    await page.waitForSelector('#loginForm');
    await page.fill('input[type="email"]', process.env.QA_VIEWER_EMAIL);
    await page.fill('input[type="password"]', process.env.QA_VIEWER_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/admin/dashboard');
    await navClick(page, 'a[href="/admin/leads"]', mobile);
    await page.waitForURL('**/admin/leads');
    await page.waitForSelector('#leadsBody tr[data-id]');
    await page.click(`tr[data-id="${leadId}"] button.view-lead-btn`);
    await page.waitForSelector('#drawerContent', { state: 'visible' });
    await page.waitForTimeout(400);
    const viewerControls = await page.isVisible('#statusControlWrap');
    assert.strictEqual(viewerControls, false, `${tag}: VIEWER must not see status controls`);
    await shot(page, `${tag}-07-viewer-readonly`);

    await ctx.close();
  }
  console.log('DONE — all widths OK');
} finally {
  await browser.close();
  await sql`DELETE FROM admin_audit_log WHERE metadata->>'leadId' IN (SELECT id::text FROM leads WHERE utm_source = ${RUN_ID})`;
  await sql`DELETE FROM leads WHERE utm_source = ${RUN_ID}`;
  const left = await sql`SELECT count(*)::int n FROM leads WHERE utm_source = ${RUN_ID}`;
  console.log('cleanup: RUN_ID leads remaining =', left[0].n);
}
