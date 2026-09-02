const { chromium } = require('playwright');
const assert = require('assert');
const { neon } = require('@neondatabase/serverless');

const REQUIRED_ENVS = [
  'VERCEL_PREVIEW_URL',
  'VERCEL_AUTOMATION_BYPASS_SECRET',
  'QA_ADMIN_EMAIL',
  'QA_ADMIN_PASSWORD',
  'QA_VIEWER_EMAIL',
  'QA_VIEWER_PASSWORD',
  'DATABASE_URL'
];

for (const env of REQUIRED_ENVS) {
  if (!process.env[env]) {
    console.error(`❌ Required environment variable missing: ${env}`);
    process.exit(1);
  }
}

const BASE_URL = process.env.VERCEL_PREVIEW_URL.replace(/\/$/, '');
const BYPASS_SECRET = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

async function seedLead(sql) {
  const insertRes = await sql`
    INSERT INTO leads (
      phone, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
      page_url, referrer, status, status_version
    ) VALUES (
      '5555555555', 'TEST_BROWSER', 'TEST', 'TEST', 'TEST', 'TEST',
      'http://test', 'http://test', 'NEW', 1
    ) RETURNING id
  `;
  return insertRes[0].id;
}

(async () => {
  console.log('--- STARTING WORKFLOW BROWSER E2E ---');
  
  const sql = neon(process.env.DATABASE_URL);
  const syntheticLeadId = await seedLead(sql);

  const browser = await chromium.launch();
  const context = await browser.newContext({
    extraHTTPHeaders: {
      'x-vercel-protection-bypass': BYPASS_SECRET
    }
  });

  // Also set bypass cookie
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
    
    // Navigate to Leads via UI
    await page.click('a[href="/admin/leads"]');
    await page.waitForURL('**/admin/leads');
    console.log('    Navigated to Leads.');
    
    // Find the synthetic lead
    await page.waitForSelector(`tr[data-id="${syntheticLeadId}"]`);
    
    // Open Workflow Drawer
    await page.click(`tr[data-id="${syntheticLeadId}"] button.view-lead-btn`);
    await page.waitForSelector('#workflow-drawer.open');
    console.log('    Workflow Drawer opened.');
    
    // Change to CONTACTED
    await page.selectOption('#status-select', 'CONTACTED');
    
    // Save and wait for network
    const [contactedRes] = await Promise.all([
      page.waitForResponse(res => res.url().includes('/api/admin/leads/status') && res.status() === 200),
      page.click('#save-status-btn')
    ]);
    console.log('    Saved CONTACTED (PATCH 200 OK).');
    
    // Verify badge
    const badgeText = await page.innerText('#current-status-badge');
    assert(badgeText.includes('Contactado'), 'Badge should show Contactado');
    
    // Close and reopen to verify persistence
    await page.click('#close-drawer-btn');
    await page.waitForSelector('#workflow-drawer', { state: 'hidden' });
    await page.click(`tr[data-id="${syntheticLeadId}"] button.view-lead-btn`);
    await page.waitForSelector('#workflow-drawer.open');
    const reopenedBadgeText = await page.innerText('#current-status-badge');
    assert(reopenedBadgeText.includes('Contactado'), 'Persistence verified.');

    // Change to REJECTED -> Reason conditional
    await page.selectOption('#status-select', 'REJECTED');
    await page.waitForSelector('#reason-select', { state: 'visible' });
    await page.selectOption('#reason-select', 'INVALID_DATA');
    
    // Save, expect confirmation modal
    await page.click('#save-status-btn');
    await page.waitForSelector('#confirmation-modal', { state: 'visible' });
    
    const [rejectedRes] = await Promise.all([
      page.waitForResponse(res => res.url().includes('/api/admin/leads/status') && res.status() === 200),
      page.click('#confirm-action-btn')
    ]);
    console.log('    Saved REJECTED (PATCH 200 OK).');
    
    const rejectBadgeText = await page.innerText('#current-status-badge');
    assert(rejectBadgeText.includes('Rechazado'), 'Badge should show Rechazado');
    
    // Hide reason
    await page.selectOption('#status-select', 'CONTACTED');
    await page.waitForSelector('#reason-container.hidden');
    console.log('    Reason hidden when switching back to CONTACTED.');

    // Conflict Real
    console.log('[+] Testing 409 Conflict Modal...');
    // Do a background patch using page.evaluate to simulate another user
    await page.evaluate(async (id) => {
      await fetch('/api/admin/leads/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: 'VALIDATED', expectedVersion: 3 })
      });
    }, syntheticLeadId);
    
    // Save in UI with outdated version
    await page.click('#save-status-btn');
    const conflictRes = await page.waitForResponse(res => res.url().includes('/api/admin/leads/status'));
    assert(conflictRes.status() === 409, 'Should return 409 Conflict');
    
    // Wait for conflict UI
    await page.waitForSelector('.conflict-message', { state: 'visible' });
    console.log('    Conflict modal UI correctly shown.');
    
    // Close drawer
    await page.click('#close-drawer-btn');
    
    // VIEWER test
    console.log('[+] Testing VIEWER RBAC...');
    await page.click('#logout-btn');
    await page.waitForURL('**/admin/login');
    
    await page.fill('input[type="email"]', process.env.QA_VIEWER_EMAIL);
    await page.fill('input[type="password"]', process.env.QA_VIEWER_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/admin/dashboard');
    
    await page.click('a[href="/admin/leads"]');
    await page.waitForURL('**/admin/leads');
    
    await page.waitForSelector(`tr[data-id="${syntheticLeadId}"]`);
    await page.click(`tr[data-id="${syntheticLeadId}"] button.view-lead-btn`);
    await page.waitForSelector('#workflow-drawer.open');
    
    // Save controls absent
    const saveBtnVisible = await page.isVisible('#save-status-btn');
    assert(!saveBtnVisible, 'VIEWER should not see Save button');
    
    // Background PATCH 403
    const viewerPatchStatus = await page.evaluate(async (id) => {
      const res = await fetch('/api/admin/leads/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: 'CONTACTED', expectedVersion: 4 })
      });
      return res.status;
    }, syntheticLeadId);
    
    assert(viewerPatchStatus === 403, `VIEWER PATCH should return 403, got ${viewerPatchStatus}`);
    console.log('    VIEWER controls and API access correctly restricted.');

    console.log('--- BROWSER E2E PASSED ---');
  } catch (err) {
    console.error('--- BROWSER E2E FAILED ---');
    console.error(err);
    process.exit(1);
  } finally {
    await browser.close();
    await sql`DELETE FROM leads WHERE utm_source = 'TEST_BROWSER'`;
  }
})();
