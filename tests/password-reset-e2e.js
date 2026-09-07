const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8082;
let server;

async function startServer() {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      let filePath = '.' + req.url.split('?')[0].split('#')[0];
      if (filePath === './admin/') {
        filePath = './admin/index.html';
      } else if (filePath === './api/admin/session') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ authenticated: false }));
        return;
      }
      
      const extname = String(path.extname(filePath)).toLowerCase();
      const mimeTypes = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.svg': 'image/svg+xml'
      };

      const contentType = mimeTypes[extname] || 'application/octet-stream';

      fs.readFile(path.join(__dirname, '..', filePath), (error, content) => {
        if (error) {
          if(error.code == 'ENOENT') {
            res.writeHead(404);
            res.end('Not found');
          } else {
            res.writeHead(500);
            res.end('Server error');
          }
        } else {
          res.writeHead(200, { 'Content-Type': contentType });
          res.end(content, 'utf-8');
        }
      });
    });
    server.listen(PORT, '127.0.0.1', () => {
      resolve();
    });
  });
}

function stopServer() {
  if (server) server.close();
}

async function runTests() {
  await startServer();
  let browser;
  let passCount = 0;
  let failCount = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`✅ PASS: ${message}`);
      passCount++;
    } else {
      console.error(`❌ FAIL: ${message}`);
      failCount++;
    }
  }

  try {
    browser = await chromium.launch({ headless: true });
    
    // Test 1: Request Recovery UI Toggle
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/admin/`);
    
    await page.click('#forgotPasswordBtn');
    
    const loginHidden = await page.locator('#loginCard').getAttribute('hidden');
    const recoveryHidden = await page.locator('#recoveryCard').getAttribute('hidden');
    
    assert(loginHidden !== null, 'Login card is hidden');
    assert(recoveryHidden === null, 'Recovery card is visible');

    // Test 2: Confirm Recovery API Call
    await page.route('**/api/admin/password-reset/request', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true })
      });
    });

    await page.fill('input#recoveryEmail', 'test@bait.test');
    await page.click('#recoverySubmitBtn');

    await page.waitForSelector('#recoverySuccessMessage:visible');
    const successMsg = await page.locator('#recoverySuccessMessage').textContent();
    assert(successMsg.includes('recibirás un enlace'), 'Shows success message');

    // Test 3: Reset Password UI
    const page2 = await browser.newPage();
    await page2.goto(`http://127.0.0.1:${PORT}/admin/reset-password.html#token=valid_token`);
    
    const title = await page2.locator('.login-title').textContent();
    assert(title.trim() === 'Nueva contraseña', 'Correct title');
    
    await page2.route('**/api/admin/password-reset/confirm', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true })
      });
    });

    await page2.fill('input#password', 'NewPass1234!');
    await page2.fill('input#passwordConfirm', 'NewPass1234!');
    await page2.click('#submitBtn');

    await page2.waitForSelector('#successMessage:visible');
    const successMsg2 = await page2.locator('#successMessage').textContent();
    assert(successMsg2.includes('Contraseña actualizada'), 'Shows success message on reset');

    console.log(`\n=== password-reset-e2e Results: ${passCount} passed, ${failCount} failed ===\n`);
    if (failCount > 0) process.exit(1);

  } catch (err) {
    console.error('Test execution failed:', err);
    process.exit(1);
  } finally {
    if (browser) await browser.close();
    stopServer();
  }
}

runTests();
