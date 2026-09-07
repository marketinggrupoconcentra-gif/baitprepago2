/**
 * tests/form-security-browser-e2e.js
 * Stage 1H — Playwright E2E for NIP conditional validation, email capture,
 * server-side CAPTCHA and the privacy link, against a deployed Preview URL.
 *
 * Run with: node --env-file=.env.branch tests/form-security-browser-e2e.js
 * Requires VERCEL_PREVIEW_URL to point at a Preview deployment that
 * includes Stage 1H (this branch), plus VERCEL_AUTOMATION_BYPASS_SECRET if
 * Vercel Deployment Protection is enabled on that preview.
 */
const { chromium } = require('playwright');
const assert = require('assert');

if (!process.env.VERCEL_PREVIEW_URL) {
  console.error('❌ Required environment variable missing: VERCEL_PREVIEW_URL');
  process.exit(1);
}

const BASE_URL = process.env.VERCEL_PREVIEW_URL.replace(/\/$/, '');
const BYPASS_SECRET = process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '';

function todayCDMX() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const v = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${v.year}-${v.month}-${v.day}`;
}

function addCivilDays(dateOnly, days) {
  const [y, m, d] = dateOnly.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + days * 86400000);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

async function newContext(browser, viewport) {
  const ctx = await browser.newContext({
    viewport: viewport || { width: 1280, height: 900 },
    extraHTTPHeaders: BYPASS_SECRET ? { 'x-vercel-protection-bypass': BYPASS_SECRET } : {}
  });
  return ctx;
}

async function fillStep1(page, { phone, nip, nipValidUntil }) {
  await page.fill('#pf-phone', phone);
  await page.fill('#pf-phone-confirm', phone);
  await page.fill('#pf-nip', nip);
  await page.fill('#pf-nip-confirm', nip);
  if (nipValidUntil !== undefined) {
    // let the input-driven visibility toggle settle
    await page.waitForTimeout(50);
    const visible = await page.isVisible('#pf-nip-valid-until-field:not(.pf-hidden)');
    if (visible && nipValidUntil !== null) {
      await page.fill('#pf-nip-valid-until', nipValidUntil);
    }
  }
}

(async () => {
  console.log('--- STARTING FORM SECURITY BROWSER E2E (Stage 1H) ---');
  const browser = await chromium.launch();
  let testFailed = false;

  try {
    /* ── Scenario: NIP different from last4 → date field stays hidden ── */
    {
      const ctx = await newContext(browser);
      const page = await ctx.newPage();
      await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });

      const phone = '5512340000';
      await fillStep1(page, { phone, nip: '1234' }); // last4 = 0000, no match
      const hidden = await page.isVisible('#pf-nip-valid-until-field.pf-hidden');
      assert.ok(hidden, 'NIP != last4: el campo de vigencia permanece oculto');
      await ctx.close();
    }

    /* ── Scenario: NIP == last4 → date field appears and gates submit ── */
    {
      const ctx = await newContext(browser);
      const page = await ctx.newPage();
      await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });

      const phone = '5512345678'; // last4 = 5678
      await page.fill('#pf-phone', phone);
      await page.fill('#pf-phone-confirm', phone);
      await page.fill('#pf-nip', '5678');
      await page.fill('#pf-nip-confirm', '5678');
      await page.waitForTimeout(50);

      const visible = await page.isVisible('#pf-nip-valid-until-field:not(.pf-hidden)');
      assert.ok(visible, 'NIP == last4: el campo de vigencia se muestra');

      // Submit without a date → blocked, still on step 1
      await page.click('#pf-btn-1');
      await page.waitForTimeout(100);
      const stillStep1 = await page.isVisible('#pf-step-1:not(.pf-hidden)');
      assert.ok(stillStep1, 'Sin fecha de vigencia → no avanza al paso 2');

      // +6 days → rejected client-side
      const today = todayCDMX();
      await page.fill('#pf-nip-valid-until', addCivilDays(today, 6));
      await page.click('#pf-btn-1');
      await page.waitForTimeout(100);
      const stillStep1b = await page.isVisible('#pf-step-1:not(.pf-hidden)');
      assert.ok(stillStep1b, 'Vigencia +6 días → rechazada, no avanza');

      // +5 days → accepted, advances to step 2
      await page.fill('#pf-nip-valid-until', addCivilDays(today, 5));
      await page.click('#pf-btn-1');
      await page.waitForTimeout(150);
      const onStep2 = await page.isVisible('#pf-step-2:not(.pf-hidden)');
      assert.ok(onStep2, 'Vigencia +5 días → aceptada, avanza al paso 2');
      await ctx.close();
    }

    /* ── Scenario: Email validation ── */
    {
      const ctx = await newContext(browser);
      const page = await ctx.newPage();
      await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });
      await fillStep1(page, { phone: '5511110000', nip: '1234' });
      await page.click('#pf-btn-1');
      await page.waitForTimeout(100);

      await page.fill('#pf-nombre', 'Juana');
      await page.fill('#pf-apellido', 'Pérez');
      await page.fill('#pf-email', 'correo-invalido');
      await page.click('#pf-btn-2');
      await page.waitForTimeout(100);
      const stillStep2 = await page.isVisible('#pf-step-2:not(.pf-hidden)');
      assert.ok(stillStep2, 'Email inválido bloquea el avance');

      await page.fill('#pf-email', 'juana@example.com');
      await page.click('#pf-btn-2');
      await page.waitForTimeout(200);
      const onStep3 = await page.isVisible('#pf-step-3:not(.pf-hidden)');
      assert.ok(onStep3, 'Email válido permite avanzar al paso 3');
      await ctx.close();
    }

    /* ── Scenario: CAPTCHA wrong → blocked + new challenge; correct → allowed to submit ── */
    {
      const ctx = await newContext(browser);
      const page = await ctx.newPage();
      const leadRequests = [];
      page.on('response', res => {
        if (res.url().includes('/api/leads')) leadRequests.push(res.status());
      });

      await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });
      await fillStep1(page, { phone: '5599990000', nip: '1234' });
      await page.click('#pf-btn-1');
      await page.waitForTimeout(100);
      await page.fill('#pf-nombre', 'Carlos');
      await page.fill('#pf-apellido', 'Ruiz');
      await page.fill('#pf-email', 'carlos@example.com');
      await page.click('#pf-btn-2');
      await page.waitForTimeout(300); // allow /api/captcha/challenge to resolve

      const imgSrcBefore = await page.getAttribute('#pf-captcha-img-el', 'src');
      assert.ok(imgSrcBefore && imgSrcBefore.startsWith('data:image/svg+xml'), 'El CAPTCHA se renderiza como imagen SVG servida por backend');

      await page.fill('#pf-captcha-input', '000000'); // near-certainly wrong
      await page.fill('#pf-wa-code', '123456');
      await page.check('#pf-consent');
      await page.click('#pf-btn-3');
      await page.waitForTimeout(500);

      assert.ok(leadRequests.length >= 1 && leadRequests[0] !== 201, 'CAPTCHA incorrecto: /api/leads no responde 201 (lead no se inserta)');
      const stillStep3 = await page.isVisible('#pf-step-3:not(.pf-hidden)');
      assert.ok(stillStep3, 'CAPTCHA incorrecto no navega fuera del formulario');

      await page.waitForTimeout(300);
      const imgSrcAfter = await page.getAttribute('#pf-captcha-img-el', 'src');
      assert.notStrictEqual(imgSrcAfter, imgSrcBefore, 'Tras error de CAPTCHA se solicita un nuevo challenge');

      await ctx.close();
    }

    /* ── Scenario: Privacy link opens the real integral notice (HTTP 200) ── */
    {
      const ctx = await newContext(browser);
      const page = await ctx.newPage();
      await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });
      const res = await page.request.get(BASE_URL + '/aviso-de-privacidad/');
      assert.strictEqual(res.status(), 200, '/aviso-de-privacidad/ responde 200');
      const body = await res.text();
      assert.ok(/Aviso de Privacidad/i.test(body), 'La página de aviso contiene el título esperado');

      const href = await page.getAttribute('a.pf-link', 'href');
      assert.ok(href && !href.endsWith('#') && href.includes('aviso-de-privacidad'), 'El checkbox de consentimiento ya no enlaza a "#"');
      await ctx.close();
    }

    /* ── Mobile viewport smoke ── */
    {
      const ctx = await newContext(browser, { width: 390, height: 844 });
      const page = await ctx.newPage();
      await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });
      const visible = await page.isVisible('#portability-form-wrapper');
      assert.ok(visible, 'El formulario es visible en viewport móvil');
      await ctx.close();
    }

    console.log('✅ ALL FORM SECURITY BROWSER E2E SCENARIOS PASSED');
  } catch (err) {
    testFailed = true;
    console.error('❌ FAIL:', err.message);
  } finally {
    await browser.close();
  }

  process.exit(testFailed ? 1 : 0);
})();
