const { chromium } = require('playwright');
const assert = require('assert');
const { resolveDatabaseUrl } = require('../lib/db.js');
const { neon } = require('@neondatabase/serverless');

const REQUIRED_ENVS = [
  'VERCEL_PREVIEW_URL',
  'VERCEL_AUTOMATION_BYPASS_SECRET',
  'QA_ADMIN_EMAIL',
  'QA_ADMIN_PASSWORD',
  'QA_VIEWER_EMAIL',
  'QA_VIEWER_PASSWORD'
];

for (const env of REQUIRED_ENVS) {
  if (!process.env[env]) {
    console.error(`❌ Required environment variable missing: ${env}`);
    process.exit(1);
  }
}

const BASE_URL = process.env.VERCEL_PREVIEW_URL.replace(/\/$/, '');
const BYPASS_SECRET = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

// PII / XSS sentinels used by the privacy assertions.
const RAW_PHONE_PRIV = '5598765432';
const RAW_IP = '203.0.113.77';
const RAW_UA = 'EvilUA/1.0-SENTINEL';
const FBCLID_SENTINEL = 'FBCLID_LEAK_SENTINEL';
const XSS_CAMPAIGN = '<img src=x onerror="window.__xssCampaign=1">';
const XSS_CONTENT = '"><script>window.__xssContent=1</script>';
const JS_PAGE_URL = 'javascript:window.__xssPage=1';
const JS_REFERRER = 'javascript:window.__xssRef=1';

async function seedLead(sql, runId, o = {}) {
  const insertRes = await sql`
    INSERT INTO leads (
      phone, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
      fbclid, fb_ad_id, fb_adset_id, fb_campaign_id, ip, user_agent,
      page_url, referrer, status, status_version
    ) VALUES (
      ${o.phone || '5550000000'}, ${runId}, ${o.medium || 'TEST'}, ${o.campaign || 'TEST'},
      ${o.content || 'TEST'}, ${o.term || 'TEST'},
      ${o.fbclid || null}, ${o.fbAdId || null}, ${o.fbAdsetId || null}, ${o.fbCampaignId || null},
      ${o.ip || null}, ${o.ua || null},
      ${o.pageUrl || 'https://example.com/landing'}, ${o.referrer || 'https://example.com'},
      ${o.status || 'NEW'}, ${o.version || 1}
    ) RETURNING id
  `;
  return insertRes[0].id;
}

function leadRow(sql, id) {
  return sql`SELECT status, status_reason, status_version FROM leads WHERE id = ${id}`.then(r => r[0]);
}

(async () => {
  console.log('--- STARTING WORKFLOW BROWSER E2E ---');
  const dbUrl = resolveDatabaseUrl(process.env);
  const sql = neon(dbUrl);

  const RUN_ID = 'BROWSER_TEST_' + Date.now();
  let testFailed = false;

  const leadA = await seedLead(sql, RUN_ID, { phone: '5551110001' }); // full workflow chain
  const leadB = await seedLead(sql, RUN_ID, { phone: '5551110002' }); // COMPLETED terminal confirm
  const leadC = await seedLead(sql, RUN_ID, { phone: '5551110003' }); // CANCELLED terminal confirm
  const leadD = await seedLead(sql, RUN_ID, { phone: '5551110004' }); // 409 conflict
  const leadE = await seedLead(sql, RUN_ID, {                          // privacy / XSS
    phone: RAW_PHONE_PRIV,
    campaign: XSS_CAMPAIGN,
    content: XSS_CONTENT,
    ip: RAW_IP,
    ua: RAW_UA,
    fbclid: FBCLID_SENTINEL,
    pageUrl: JS_PAGE_URL,
    referrer: JS_REFERRER
  });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    extraHTTPHeaders: {
      'x-vercel-protection-bypass': BYPASS_SECRET
    }
  });
  const page = await context.newPage();

  // Count every real status PATCH the UI issues.
  let patchCount = 0;
  page.on('request', (req) => {
    if (req.method() === 'PATCH' && req.url().includes('/api/admin/leads/status')) patchCount++;
  });

  const login = async (email, password) => {
    await page.goto(`${BASE_URL}/admin`);
    await page.waitForSelector('#loginForm');
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/admin/dashboard');
  };

  const gotoLeads = async () => {
    await page.click('a[href="/admin/leads"]');
    await page.waitForURL('**/admin/leads');
    await page.waitForSelector('#leadsBody tr[data-id]');
  };

  const openDrawer = async (id) => {
    const rowSel = `tr[data-id="${id}"]`;
    await page.waitForSelector(rowSel);
    await page.click(`${rowSel} button.view-lead-btn`);
    await page.waitForSelector('#drawerContent', { state: 'visible' });
  };

  const expectBadge = async (label) => {
    await page.waitForFunction(
      (txt) => document.getElementById('detailStatusBadge').textContent.trim() === txt,
      label
    );
  };

  // Direct save (no terminal confirmation modal expected).
  const directSavePatch = async () => {
    const [res] = await Promise.all([
      page.waitForResponse(r => r.url().includes('/api/admin/leads/status') && r.request().method() === 'PATCH'),
      page.click('#btnSaveStatus')
    ]);
    return res;
  };

  // Terminal confirmation: open modal, confirm, expect exactly one PATCH.
  const modalConfirmPatch = async () => {
    const before = patchCount;
    await page.click('#btnSaveStatus');
    await page.waitForSelector('#statusConfirmModal', { state: 'visible' });
    const [res] = await Promise.all([
      page.waitForResponse(r => r.url().includes('/api/admin/leads/status') && r.request().method() === 'PATCH'),
      page.click('#btnConfirmStatus')
    ]);
    assert.strictEqual(patchCount, before + 1, 'Confirm must produce exactly 1 PATCH');
    return res;
  };

  // Terminal confirmation cancelled: modal opens, cancel, expect zero PATCH / zero DB mutation.
  const modalCancelNoop = async (leadId) => {
    const before = patchCount;
    const dbBefore = await leadRow(sql, leadId);
    await page.click('#btnSaveStatus');
    await page.waitForSelector('#statusConfirmModal', { state: 'visible' });
    await page.click('#btnCancelStatus');
    await page.waitForSelector('#statusConfirmModal', { state: 'hidden' });
    await page.waitForTimeout(500);
    assert.strictEqual(patchCount, before, 'Cancel must produce 0 PATCH');
    const dbAfter = await leadRow(sql, leadId);
    assert.strictEqual(dbAfter.status, dbBefore.status, 'Cancel must produce 0 DB mutation (status)');
    assert.strictEqual(dbAfter.status_version, dbBefore.status_version, 'Cancel must produce 0 DB mutation (version)');
  };

  try {
    // ===================================================================
    // PART 8a — SUPER_ADMIN full workflow chain on lead A
    // ===================================================================
    console.log('[+] 8a. SUPER_ADMIN workflow chain...');
    await login(process.env.QA_ADMIN_EMAIL, process.env.QA_ADMIN_PASSWORD);
    await gotoLeads();
    await openDrawer(leadA);

    // NEW -> CONTACTED (non-terminal, no modal)
    await page.selectOption('#statusSelect', 'CONTACTED');
    let res = await directSavePatch();
    assert.strictEqual(res.status(), 200, 'NEW->CONTACTED should be 200');
    await expectBadge('Contactado');
    let db = await leadRow(sql, leadA);
    assert.strictEqual(db.status, 'CONTACTED');
    assert.strictEqual(db.status_version, 2, 'version 1 -> 2');
    console.log('    NEW -> CONTACTED OK (v2).');

    // CONTACTED -> REJECTED / INVALID_DATA (terminal): cancel then confirm
    await page.selectOption('#statusSelect', 'REJECTED');
    await page.waitForSelector('#reasonSelect', { state: 'visible' });
    await page.selectOption('#reasonSelect', 'INVALID_DATA');
    await modalCancelNoop(leadA);
    console.log('    Terminal confirm cancelled: 0 PATCH / 0 DB mutation.');

    res = await modalConfirmPatch();
    assert.strictEqual(res.status(), 200, 'REJECTED confirm should be 200');
    await expectBadge('Rechazado');
    db = await leadRow(sql, leadA);
    assert.strictEqual(db.status, 'REJECTED');
    assert.strictEqual(db.status_reason, 'INVALID_DATA');
    assert.strictEqual(db.status_version, 3);
    console.log('    CONTACTED -> REJECTED/INVALID_DATA OK (v3, 1 PATCH).');

    // REJECTED / INVALID_DATA -> REJECTED / DUPLICATE (same status, reason mutation, no modal)
    await page.selectOption('#reasonSelect', 'DUPLICATE');
    res = await directSavePatch();
    assert.strictEqual(res.status(), 200, 'reason mutation should be 200');
    let body = await res.json();
    assert.strictEqual(body.changed, true, 'same-status reason mutation is a real change');
    assert.strictEqual(body.lead.statusVersion, 4, 'version increments on reason mutation');
    db = await leadRow(sql, leadA);
    assert.strictEqual(db.status, 'REJECTED');
    assert.strictEqual(db.status_reason, 'DUPLICATE');
    assert.strictEqual(db.status_version, 4);
    console.log('    REJECTED/INVALID_DATA -> REJECTED/DUPLICATE OK (changed=true, v4).');

    // REJECTED -> CONTACTED (non-terminal): reason must clear to NULL
    await page.selectOption('#statusSelect', 'CONTACTED');
    await page.waitForSelector('#reasonSelect', { state: 'hidden' });
    res = await directSavePatch();
    assert.strictEqual(res.status(), 200, 'REJECTED->CONTACTED should be 200');
    db = await leadRow(sql, leadA);
    assert.strictEqual(db.status, 'CONTACTED');
    assert.strictEqual(db.status_reason, null, 'status_reason must become NULL');
    assert.strictEqual(db.status_version, 5);
    console.log('    REJECTED -> CONTACTED OK (reason NULL, v5).');

    await page.click('#btnCloseDrawer');
    await page.waitForSelector('#leadDrawer[aria-hidden="true"]');

    // ===================================================================
    // PART 8b — COMPLETED terminal confirmation on lead B
    // ===================================================================
    console.log('[+] 8b. COMPLETED terminal confirmation...');
    await openDrawer(leadB);
    await page.selectOption('#statusSelect', 'COMPLETED');
    await modalCancelNoop(leadB);
    res = await modalConfirmPatch();
    assert.strictEqual(res.status(), 200);
    await expectBadge('Completado');
    db = await leadRow(sql, leadB);
    assert.strictEqual(db.status, 'COMPLETED');
    assert.strictEqual(db.status_reason, null);
    assert.strictEqual(db.status_version, 2);
    await page.click('#btnCloseDrawer');
    await page.waitForSelector('#leadDrawer[aria-hidden="true"]');
    console.log('    COMPLETED confirmed (cancel=0 PATCH, confirm=1 PATCH).');

    // ===================================================================
    // PART 8c — CANCELLED terminal confirmation on lead C
    // ===================================================================
    console.log('[+] 8c. CANCELLED terminal confirmation...');
    await openDrawer(leadC);
    await page.selectOption('#statusSelect', 'CANCELLED');
    await page.waitForSelector('#reasonSelect', { state: 'visible' });
    await page.selectOption('#reasonSelect', 'CUSTOMER_DECLINED');
    await modalCancelNoop(leadC);
    res = await modalConfirmPatch();
    assert.strictEqual(res.status(), 200);
    await expectBadge('Cancelado');
    db = await leadRow(sql, leadC);
    assert.strictEqual(db.status, 'CANCELLED');
    assert.strictEqual(db.status_reason, 'CUSTOMER_DECLINED');
    await page.click('#btnCloseDrawer');
    await page.waitForSelector('#leadDrawer[aria-hidden="true"]');
    console.log('    CANCELLED confirmed (cancel=0 PATCH, confirm=1 PATCH).');

    // ===================================================================
    // PART 8d — 409 conflict UX on lead D (no silent overwrite)
    // ===================================================================
    console.log('[+] 8d. 409 conflict UX...');
    await openDrawer(leadD);
    // Another actor mutates the lead out from under the drawer.
    const bgStatus = await page.evaluate(async (id) => {
      const r = await fetch('/api/admin/leads/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: 'CONTACTED', expectedVersion: 1 })
      });
      return r.status;
    }, leadD);
    assert.strictEqual(bgStatus, 200, 'background mutation should succeed');

    // Drawer still holds the stale version -> save must surface a real 409.
    await page.selectOption('#statusSelect', 'VALIDATED');
    const [conflictRes] = await Promise.all([
      page.waitForResponse(r => r.url().includes('/api/admin/leads/status') && r.request().method() === 'PATCH'),
      page.click('#btnSaveStatus')
    ]);
    assert.strictEqual(conflictRes.status(), 409, 'stale version must return HTTP 409');
    await page.waitForSelector('.conflict-message', { state: 'visible' });
    db = await leadRow(sql, leadD);
    assert.strictEqual(db.status, 'CONTACTED', 'remote status must not be overwritten');
    assert.strictEqual(db.status_version, 2);
    await page.click('#btnCloseDrawer');
    await page.waitForSelector('#leadDrawer[aria-hidden="true"]');
    console.log('    Real HTTP 409 + visible conflict message, no silent overwrite.');

    // ===================================================================
    // PART 8e — Privacy / XSS on lead E (no phone reveal)
    // ===================================================================
    console.log('[+] 8e. Privacy / XSS assertions...');
    await page.click('a[href="/admin/dashboard"]');
    await page.waitForURL('**/admin/dashboard');
    await gotoLeads();
    await page.waitForSelector(`tr[data-id="${leadE}"]`);

    const xss = await page.evaluate(() => ({
      c: !!window.__xssCampaign,
      ct: !!window.__xssContent,
      p: !!window.__xssPage,
      r: !!window.__xssRef
    }));
    assert.ok(!xss.c && !xss.ct && !xss.p && !xss.r, 'no XSS sentinel may execute');

    const tableHtml = await page.innerHTML('#leadsTable');
    assert.ok(!tableHtml.includes(RAW_PHONE_PRIV), 'raw phone absent from table DOM');
    assert.ok(!tableHtml.includes(FBCLID_SENTINEL), 'fbclid absent from table DOM');
    assert.ok(!tableHtml.includes(RAW_IP), 'raw IP absent from table DOM');
    assert.ok(!tableHtml.includes(RAW_UA), 'raw UA absent from table DOM');
    assert.strictEqual(await page.$('#leadsBody img'), null, 'no injected <img> in table');
    assert.strictEqual(await page.$('#leadsBody script'), null, 'no injected <script> in table');

    await openDrawer(leadE);
    const drawerHtml = await page.innerHTML('#drawerContent');
    assert.ok(!drawerHtml.includes(RAW_PHONE_PRIV), 'raw phone absent from drawer DOM');
    assert.ok(!drawerHtml.includes(FBCLID_SENTINEL), 'fbclid absent from drawer DOM');
    assert.ok(!drawerHtml.includes(RAW_IP), 'raw IP absent from drawer DOM');
    assert.ok(!drawerHtml.includes(RAW_UA), 'raw UA absent from drawer DOM');
    assert.strictEqual(await page.$('#drawerContent img'), null, 'no injected <img> in drawer');
    assert.strictEqual(await page.$('#drawerContent script'), null, 'no injected <script> in drawer');

    const campaignText = await page.textContent('#detailCampaign');
    assert.strictEqual(campaignText, XSS_CAMPAIGN, 'campaign payload rendered as inert text');

    const pageHref = (await page.getAttribute('#detailPageUrl', 'href')) || '';
    assert.ok(!/^javascript:/i.test(pageHref), 'page URL must never be a javascript: link');
    assert.strictEqual(pageHref, '#', 'unsafe page URL falls back to #');
    const referrerText = (await page.textContent('#detailReferrer')).trim();
    assert.strictEqual(referrerText, '-', 'javascript: referrer is dropped');

    const phoneText = (await page.textContent('#detailPhone')).trim();
    assert.ok(/^\*+\d{4}$/.test(phoneText), 'phone shown masked');
    assert.ok(!phoneText.includes(RAW_PHONE_PRIV), 'masked phone does not expose the raw number');

    const client = await page.evaluate(() => {
      const dump = (s) => { const o = {}; for (let i = 0; i < s.length; i++) { const k = s.key(i); o[k] = s.getItem(k); } return o; };
      return {
        ls: dump(window.localStorage),
        ss: dump(window.sessionStorage),
        cookie: document.cookie,
        href: location.href
      };
    });
    assert.strictEqual(Object.keys(client.ls).length, 0, 'localStorage must be empty');
    assert.strictEqual(Object.keys(client.ss).length, 0, 'sessionStorage must be empty');
    assert.ok(!client.cookie.includes('bait_admin_session'), 'session token must not be JS-readable');
    for (const bucket of [JSON.stringify(client.ls), JSON.stringify(client.ss), client.cookie, client.href]) {
      assert.ok(!bucket.includes(RAW_PHONE_PRIV), 'no raw phone in storage / cookies / URL');
      assert.ok(!bucket.includes(FBCLID_SENTINEL), 'no fbclid in storage / cookies / URL');
      assert.ok(!bucket.includes(RAW_IP), 'no raw IP in storage / cookies / URL');
    }

    const apiShape = await page.evaluate(async (id) => {
      const detail = await (await fetch(`/api/admin/leads/detail?id=${id}`)).json();
      const list = await (await fetch('/api/admin/leads?limit=25')).json();
      return { detail, listStr: JSON.stringify(list) };
    }, leadE);
    for (const forbidden of ['phone', 'nip', 'phoneConfirm', 'phone_confirm', 'ip', 'userAgent', 'user_agent', 'fbclid', 'rawIp']) {
      assert.ok(!(forbidden in apiShape.detail), `detail API must not expose "${forbidden}"`);
    }
    const detailStr = JSON.stringify(apiShape.detail);
    for (const sentinel of [RAW_PHONE_PRIV, RAW_IP, RAW_UA, FBCLID_SENTINEL]) {
      assert.ok(!detailStr.includes(sentinel), 'detail API body carries no raw PII sentinel');
      assert.ok(!apiShape.listStr.includes(sentinel), 'list API body carries no raw PII sentinel');
    }
    await page.click('#btnCloseDrawer');
    await page.waitForSelector('#leadDrawer[aria-hidden="true"]');
    console.log('    Privacy + XSS assertions passed.');

    // ===================================================================
    // PART 8f — VIEWER RBAC restrictions
    // ===================================================================
    console.log('[+] 8f. VIEWER RBAC...');
    await page.click('#logoutBtn');
    await page.waitForURL(/\/admin\/?$/); // logout lands on /admin/ (login page)
    await page.waitForSelector('#loginForm');
    await page.fill('input[type="email"]', process.env.QA_VIEWER_EMAIL);
    await page.fill('input[type="password"]', process.env.QA_VIEWER_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/admin/dashboard');
    await gotoLeads();

    const viewerWorkflow = await page.evaluate(async () => {
      const r = await fetch('/api/admin/leads/workflow');
      return { status: r.status, body: await r.json() };
    });
    assert.strictEqual(viewerWorkflow.status, 200, 'VIEWER can view workflow config');
    assert.strictEqual(viewerWorkflow.body.canManageStatus, false, 'VIEWER cannot manage status');

    await openDrawer(leadA);
    assert.strictEqual(await page.isVisible('#statusControlWrap'), false, 'VIEWER: status controls hidden');
    assert.strictEqual(await page.isVisible('#btnSaveStatus'), false, 'VIEWER: save control hidden');

    const viewerPatch = await page.evaluate(async (id) => {
      const r = await fetch('/api/admin/leads/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: 'CONTACTED', expectedVersion: 1 })
      });
      return r.status;
    }, leadA);
    assert.strictEqual(viewerPatch, 403, 'VIEWER direct PATCH must be 403');
    await page.click('#btnCloseDrawer');
    console.log('    VIEWER can view, cannot mutate, direct PATCH = 403.');

    console.log('--- BROWSER E2E PASSED ---');
  } catch (err) {
    testFailed = true;
    console.error('--- BROWSER E2E FAILED ---');
    console.error(err);
  } finally {
    console.log('[+] Cleaning up RUN_ID:', RUN_ID);
    await browser.close();
    if (RUN_ID) {
      await sql`DELETE FROM admin_audit_log WHERE metadata->>'leadId' IN (SELECT id::text FROM leads WHERE utm_source = ${RUN_ID})`;
      await sql`DELETE FROM leads WHERE utm_source = ${RUN_ID}`;
    }
  }

  if (testFailed) {
    process.exitCode = 1;
  }
})();
