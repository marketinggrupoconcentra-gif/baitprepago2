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

async function seedLead(sql, runId) {
  const insertRes = await sql`
    INSERT INTO leads (
      phone, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
      page_url, referrer, status, status_version
    ) VALUES (
      '5555555555', ${runId}, 'TEST', 'TEST', 'TEST', 'TEST',
      'http://test', 'http://test', 'NEW', 1
    ) RETURNING id
  `;
  return insertRes[0].id;
}

(async () => {
  console.log('--- STARTING WORKFLOW BROWSER E2E ---');
  const dbUrl = resolveDatabaseUrl(process.env);
  const sql = neon(dbUrl);
  
  const RUN_ID = 'BROWSER_TEST_' + Date.now();
  const syntheticLeadId = await seedLead(sql, RUN_ID);

  const browser = await chromium.launch();
  const context = await browser.newContext({
    extraHTTPHeaders: {
      'x-vercel-protection-bypass': BYPASS_SECRET
    }
  });

  // Set bypass cookie directly on domain
  await context.addCookies([{
    name: 'x-vercel-bypass',
    value: BYPASS_SECRET,
    domain: new URL(BASE_URL).hostname,
    path: '/'
  }]);

  const page = await context.newPage();
  
  try {
    console.log('[+] Navigating to /admin/login...');
    await page.goto(`${BASE_URL}/admin/login`);
    
    // Login as SUPER_ADMIN
    await page.fill('input[type="email"]', process.env.QA_ADMIN_EMAIL);
    await page.fill('input[type="password"]', process.env.QA_ADMIN_PASSWORD);
    await page.click('button[type="submit"]');
    
    await page.waitForURL('**/admin/dashboard');
    console.log('    Login successful (Dashboard visible).');
    
    // Navigate to Leads
    await page.click('a[href="/admin/leads"]');
    await page.waitForURL('**/admin/leads');
    console.log('    Navigated to Leads.');
    
    // Find the synthetic lead by data-id
    const rowSelector = `tr[data-id="${syntheticLeadId}"]`;
    await page.waitForSelector(rowSelector);
    
    // Open Workflow Drawer using stable class selector
    await page.click(`${rowSelector} button.view-lead-btn`);
    await page.waitForSelector('#drawerTitle', { state: 'visible' });
    console.log('    Workflow Drawer opened.');
    
    // Change to CONTACTED
    await page.selectOption('#statusSelect', 'CONTACTED');
    
    // Save and wait for network
    const [contactedRes] = await Promise.all([
      page.waitForResponse(res => res.url().includes('/api/admin/leads/status') && res.status() === 200),
      page.click('#btnSaveStatus')
    ]);
    console.log('    Saved CONTACTED (PATCH 200 OK).');
    
    // Verify badge
    const badgeText = await page.innerText('#detailStatusBadge');
    assert(badgeText.includes('Contactado') || badgeText.includes('CONTACTED'), 'Badge should reflect new status');
    
    // Close and reopen to verify persistence
    await page.click('#btnCloseDrawer');
    await page.waitForSelector('#leadDrawer', { state: 'hidden' });
    
    await page.click(`${rowSelector} button.view-lead-btn`);
    await page.waitForSelector('#drawerTitle', { state: 'visible' });
    const reopenedBadgeText = await page.innerText('#detailStatusBadge');
    assert(reopenedBadgeText.includes('Contactado') || reopenedBadgeText.includes('CONTACTED'), 'Persistence verified.');

    console.log('[+] Testing Terminal Modal Flow...');
    // Change to REJECTED -> Reason conditional
    await page.selectOption('#statusSelect', 'REJECTED');
    await page.waitForSelector('#reasonSelect', { state: 'visible' });
    await page.selectOption('#reasonSelect', 'INVALID_DATA');
    
    // Click save, expect confirmation modal
    await page.click('#btnSaveStatus');
    await page.waitForSelector('#statusConfirmModal', { state: 'visible' });
    
    // Test cancel
    await page.click('#btnCancelStatus');
    await page.waitForSelector('#statusConfirmModal', { state: 'hidden' });
    
    // Click save again, then confirm
    await page.click('#btnSaveStatus');
    await page.waitForSelector('#statusConfirmModal', { state: 'visible' });
    
    const [rejectedRes] = await Promise.all([
      page.waitForResponse(res => res.url().includes('/api/admin/leads/status') && res.status() === 200),
      page.click('#btnConfirmStatus')
    ]);
    console.log('    Saved REJECTED (PATCH 200 OK via Modal).');
    
    const rejectBadgeText = await page.innerText('#detailStatusBadge');
    assert(rejectBadgeText.includes('Rechazado') || rejectBadgeText.includes('REJECTED'), 'Badge should show Rechazado');
    
    // Hide reason
    await page.selectOption('#statusSelect', 'CONTACTED');
    await page.waitForSelector('#reasonSelect', { state: 'hidden' });
    console.log('    Reason hidden when switching back to CONTACTED.');

    console.log('[+] Testing 409 Conflict UI...');
    // Do a background patch using fetch in evaluate to simulate another user (increments expectedVersion out of sync)
    // First we need to get the real status version of the DB. Our UI has the latest version locally (2 from CONTACTED, +1 from REJECTED = 3).
    const dbData = await sql`SELECT status_version FROM leads WHERE id = ${syntheticLeadId}`;
    const realVersion = dbData[0].status_version;
    
    await page.evaluate(async ({ id, version }) => {
      await fetch('/api/admin/leads/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: 'VALIDATED', expectedVersion: version })
      });
    }, { id: syntheticLeadId, version: realVersion });
    
    // UI still has the old version. Clicking Save should trigger 409.
    // UI status is currently selected as CONTACTED.
    await page.click('#btnSaveStatus');
    const conflictRes = await page.waitForResponse(res => res.url().includes('/api/admin/leads/status'));
    assert(conflictRes.status() === 409, 'Should return 409 Conflict');
    
    // Wait for conflict UI
    await page.waitForSelector('.conflict-message', { state: 'visible' });
    console.log('    Conflict message UI correctly shown.');
    
    // Close drawer
    await page.click('#btnCloseDrawer');
    
    // VIEWER test
    console.log('[+] Testing VIEWER RBAC restrictions in UI...');
    await page.click('#logoutBtn');
    await page.waitForURL('**/admin/login');
    
    await page.fill('input[type="email"]', process.env.QA_VIEWER_EMAIL);
    await page.fill('input[type="password"]', process.env.QA_VIEWER_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/admin/dashboard');
    
    await page.click('a[href="/admin/leads"]');
    await page.waitForURL('**/admin/leads');
    
    await page.waitForSelector(rowSelector);
    await page.click(`${rowSelector} button.view-lead-btn`);
    await page.waitForSelector('#drawerTitle', { state: 'visible' });
    
    // Save controls absent (disabled or hidden via CSS)
    const canSave = await page.isVisible('#statusControlWrap');
    assert(!canSave, 'VIEWER should not see Save controls UI wrapper');
    
    console.log('    VIEWER controls correctly hidden.');

    console.log('--- BROWSER E2E PASSED ---');
  } catch (err) {
    console.error('--- BROWSER E2E FAILED ---');
    console.error(err);
    process.exit(1);
  } finally {
    console.log('[+] Cleaning up RUN_ID:', RUN_ID);
    await browser.close();
    if (RUN_ID) {
      await sql`DELETE FROM admin_audit_log WHERE metadata->>'leadId' IN (SELECT id::text FROM leads WHERE utm_source = ${RUN_ID})`;
      await sql`DELETE FROM leads WHERE utm_source = ${RUN_ID}`;
    }
  }
})();
