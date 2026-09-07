const { chromium } = require('playwright');
const fs = require('fs');

const url = process.argv[2];
const bypass = process.env.VERCEL_BYPASS_SECRET || '';

if (!url) {
  console.error('Usage: node visual-qa-admin.js <URL>');
  process.exit(1);
}

const viewports = [
  { width: 1440, height: 900, name: 'desktop-1440' },
  { width: 1280, height: 900, name: 'desktop-1280' },
  { width: 390, height: 844, name: 'mobile-390' },
  { width: 375, height: 667, name: 'mobile-375' }
];

async function runVisualQA() {
  const browser = await chromium.launch({ headless: true });
  
  if (!fs.existsSync('./qa-screenshots')) {
    fs.mkdirSync('./qa-screenshots');
  }

  for (const vp of viewports) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height }
    });
    const page = await context.newPage();

    if (bypass) {
        await context.setExtraHTTPHeaders({
            'x-vercel-protection-bypass': bypass
        });
    }

    console.log(`Navigating to ${url}/admin/ at ${vp.width}x${vp.height}...`);
    
    let cspViolations = 0;
    page.on('console', msg => {
      if (msg.type() === 'error' && msg.text().includes('Content Security Policy')) {
        cspViolations++;
      }
    });

    const response = await page.goto(`${url}/admin/`);
    await page.waitForLoadState('networkidle');
    
    // Evaluate if we are at login shell (no redirect to dashboard)
    const shellVisible = await page.locator('#loginShell').isVisible();
    if (!shellVisible) {
      console.error(`❌ FAIL: Shell not visible at ${vp.name}. Might have redirected.`);
    }

    const path = `./qa-screenshots/${vp.name}.png`;
    await page.screenshot({ path });
    console.log(`✅ Screenshot saved: ${path}`);
    
    if (cspViolations > 0) {
      console.error(`❌ FAIL: CSP Violations found in ${vp.name}`);
    }

    // Verify Asset
    const logoSrc = await page.locator('.login-logo').getAttribute('src');
    if (logoSrc) {
        const logoReq = await page.request.get(logoSrc.startsWith('http') ? logoSrc : `${url}${logoSrc}`, {
            headers: bypass ? { 'x-vercel-protection-bypass': bypass } : {}
        });
        if (logoReq.status() !== 200) {
            console.error(`❌ FAIL: Logo returned ${logoReq.status()}`);
        } else {
            console.log(`✅ Logo loaded OK (${logoReq.status()})`);
        }
    }
    
    await context.close();
  }

  await browser.close();
  console.log('✅ Visual QA Automation Complete.');
}

runVisualQA().catch(console.error);
