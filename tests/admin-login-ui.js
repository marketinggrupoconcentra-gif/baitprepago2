const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Simple static server for testing local UI
const PORT = 8081;
let server;

async function startServer() {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      let filePath = '.' + req.url;
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
    const page = await browser.newPage();
    const url = `http://127.0.0.1:${PORT}/admin/`;
    
    // Catch CSP violations or console errors
    let cspViolations = 0;
    let jsErrors = 0;
    page.on('console', msg => {
      if (msg.type() === 'error') {
        jsErrors++;
        if (msg.text().includes('Content Security Policy')) {
          cspViolations++;
        }
      }
    });

    await page.goto(url);
    await page.waitForLoadState('networkidle');

    // 1. CSP Checks
    const htmlContent = await page.content();
    assert(!htmlContent.includes('style='), 'No style= attributes found (CSP check)');
    assert(!htmlContent.includes('<style>'), 'No <style> tags found (CSP check)');
    assert(cspViolations === 0, 'No CSP Console Violations');

    // 2. Elements existence
    const title = await page.locator('.login-title').textContent();
    assert(title.trim() === 'Iniciar sesión', 'Title is correct');

    const subtitle = await page.locator('.login-subtitle').textContent();
    assert(subtitle.trim() === 'Accede al panel de administración de BAIT Prepago', 'Subtitle is correct');

    const logoCount = await page.locator('.login-logo').count();
    assert(logoCount === 1, 'BAIT Logo is visible');
    
    const emailInput = await page.locator('input#email').count();
    assert(emailInput === 1, 'Email input exists');
    
    const passInput = await page.locator('input#password').count();
    assert(passInput === 1, 'Password input exists');

    // 3. Password Toggle
    let pType = await page.locator('input#password').getAttribute('type');
    let toggleLabel = await page.locator('#togglePasswordBtn').getAttribute('aria-label');
    assert(pType === 'password', 'Initially password type');
    
    await page.click('#togglePasswordBtn');
    pType = await page.locator('input#password').getAttribute('type');
    toggleLabel = await page.locator('#togglePasswordBtn').getAttribute('aria-label');
    assert(pType === 'text' && toggleLabel === 'Ocultar contraseña', 'Toggle switches to text/Ocultar');

    await page.click('#togglePasswordBtn');
    pType = await page.locator('input#password').getAttribute('type');
    toggleLabel = await page.locator('#togglePasswordBtn').getAttribute('aria-label');
    assert(pType === 'password' && toggleLabel === 'Mostrar contraseña', 'Toggle switches back to password/Mostrar');

    // 4. Recovery interaction
    await page.click('#forgotPasswordBtn');
    const recMsg = await page.locator('#recoveryMessage');
    const isHidden = await recMsg.getAttribute('hidden');
    const msgText = await recMsg.textContent();
    assert(isHidden === null && msgText.includes('administrador del sistema'), 'Recovery message shown without alert');

    // 5. Submit behavior (Mocked)
    // We mock the API login response
    await page.route('**/api/admin/login', route => {
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'Credenciales inválidas mock' })
      });
    });

    await page.fill('input#email', 'qa-dashboard@bait.test');
    await page.fill('input#password', 'wrong_pass');
    
    await page.click('#submitBtn');
    
    // Wait for error message
    const errorMsg = await page.locator('#errorMessage');
    await errorMsg.waitFor({ state: 'visible' });
    const errText = await errorMsg.textContent();
    assert(errText.includes('Credenciales inválidas mock'), `Login error handled correctly (Got: ${errText.trim()})`);

    console.log(`\n=== admin-login-ui Results: ${passCount} passed, ${failCount} failed ===\n`);
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
