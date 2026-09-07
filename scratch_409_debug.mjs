import { chromium } from 'playwright';
import { neon } from '@neondatabase/serverless';
const BASE = process.env.VERCEL_PREVIEW_URL.replace(/\/$/, '');
const S = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const sql = neon(process.env.DATABASE_URL);
const RUN_ID = 'TEST_R4_BROWSER_409DBG_' + Date.now();
const id = (await sql`INSERT INTO leads (phone, utm_source, status, status_version) VALUES ('5557770099', ${RUN_ID}, 'NEW', 1) RETURNING id`)[0].id;
const b = await chromium.launch();
try {
  for (const w of [768, 390]) {
    const ctx = await b.newContext({ viewport: { width: w, height: 900 }, extraHTTPHeaders: { 'x-vercel-protection-bypass': S } });
    const p = await ctx.newPage();
    await p.goto(`${BASE}/admin`);
    await p.fill('input[type="email"]', process.env.QA_ADMIN_EMAIL);
    await p.fill('input[type="password"]', process.env.QA_ADMIN_PASSWORD);
    await p.click('button[type="submit"]');
    await p.waitForURL('**/admin/dashboard');
    await p.goto(`${BASE}/admin/leads`);
    await p.waitForSelector('#leadsBody tr[data-id]');
    // reset lead to v1/NEW
    await sql`UPDATE leads SET status='NEW', status_reason=NULL, status_version=1 WHERE id=${id}`;
    await p.reload();
    await p.waitForSelector('#leadsBody tr[data-id]');
    await p.click(`tr[data-id="${id}"] button.view-lead-btn`);
    await p.waitForSelector('#drawerContent', { state: 'visible' });
    const bg = await p.evaluate(async (lid) => {
      const r = await fetch('/api/admin/leads/status', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: lid, status: 'CONTACTED', expectedVersion: 1 }) });
      return r.status;
    }, id);
    await p.selectOption('#statusSelect', 'VALIDATED');
    const disabled = await p.getAttribute('#btnSaveStatus', 'disabled');
    const [resp] = await Promise.all([
      p.waitForResponse(r => r.url().includes('/api/admin/leads/status') && r.request().method() === 'PATCH').catch(() => null),
      p.click('#btnSaveStatus')
    ]);
    await p.waitForTimeout(800);
    const state = await p.evaluate(() => {
      const cm = document.querySelector('.conflict-message');
      const se = document.getElementById('statusError');
      return { cmDisplay: cm && getComputedStyle(cm).display, seDisplay: se && getComputedStyle(se).display, seVisible: se && se.offsetHeight > 0 };
    });
    console.log(`w=${w} bgStatus=${bg} saveBtnDisabled=${disabled} patchResp=${resp && resp.status()} conflictMsgDisplay=${state.cmDisplay} statusErrDisplay=${state.seDisplay} statusErrVisible=${state.seVisible}`);
    await ctx.close();
  }
} finally {
  await b.close();
  await sql`DELETE FROM admin_audit_log WHERE metadata->>'leadId' IN (SELECT id::text FROM leads WHERE utm_source = ${RUN_ID})`;
  await sql`DELETE FROM leads WHERE utm_source = ${RUN_ID}`;
  console.log('cleaned');
}
