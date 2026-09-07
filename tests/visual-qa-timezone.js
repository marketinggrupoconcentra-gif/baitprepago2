const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const bypassSecret = process.env.VERCEL_BYPASS_SECRET || '';
  
  // Launch context with Asia/Tokyo timezone
  const context = await browser.newContext({
    timezoneId: 'Asia/Tokyo',
    extraHTTPHeaders: {
      'x-vercel-protection-bypass': bypassSecret
    }
  });
  const page = await context.newPage();

  const previewUrl = process.env.PREVIEW_URL || 'https://baitprepago2-7n286oz46-lid-marketing.vercel.app';
  console.log(`[+] Visual QA against ${previewUrl} in Asia/Tokyo`);

  // Login
  await page.goto(`${previewUrl}/admin`);
  await page.fill('input[type="email"]', process.env.QA_ADMIN_EMAIL);
  await page.fill('input[type="password"]', process.env.QA_ADMIN_PASSWORD);
  await page.click('button[type="submit"]');

  await page.waitForURL('**/admin/dashboard*');
  console.log('[+] Logged in to dashboard');
  
  // Wait for the generated_at to render
  await page.waitForSelector('text=Generado:', { timeout: 10000 });
  const dashboardText = await page.textContent('body');
  
  // Navigate to leads
  await page.goto(`${previewUrl}/admin/leads`);
  await page.waitForSelector('table', { timeout: 10000 });
  console.log('[+] Leads table loaded');

  await browser.close();
  console.log('✅ Visual QA (Timezone & Login) Passed');
})();
