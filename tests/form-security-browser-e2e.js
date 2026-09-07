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
const crypto = require('crypto');
const { Pool } = require('@neondatabase/serverless');

const REQUIRED_ENVS = ['VERCEL_PREVIEW_URL', 'DATABASE_URL', 'CAPTCHA_PEPPER'];
for (const env of REQUIRED_ENVS) {
  if (!process.env[env]) {
    console.error(`❌ Required environment variable missing: ${env}`);
    process.exit(1);
  }
}

const BASE_URL = process.env.VERCEL_PREVIEW_URL.replace(/\/$/, '');
const BYPASS_SECRET = process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '';

// A tiny, valid SVG used only to stand in for the CAPTCHA image in the
// intercepted happy-path response below — its pixels are irrelevant since
// the test already knows the answer it seeded directly in the QA database.
const STUB_CAPTCHA_SVG_DATA_URI =
  'data:image/svg+xml;base64,' +
  Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="220" height="70"/>').toString('base64');

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

async function waitForCaptchaImage(page, timeout = 10000) {
  await page.waitForFunction(
    () => {
      const el = document.getElementById('pf-captcha-img-el');
      return !!(el && el.getAttribute('src') && el.getAttribute('src').startsWith('data:image/svg+xml'));
    },
    { timeout }
  );
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
      // isVisible() on a display:none element is always false regardless of
      // selector match, so check the actual hidden class instead.
      const hidden = await page.locator('#pf-nip-valid-until-field').evaluate(el => el.classList.contains('pf-hidden'));
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
      await waitForCaptchaImage(page); // allow /api/captcha/challenge to resolve

      const imgSrcBefore = await page.getAttribute('#pf-captcha-img-el', 'src');
      assert.ok(imgSrcBefore && imgSrcBefore.startsWith('data:image/svg+xml'), 'El CAPTCHA se renderiza como imagen SVG servida por backend');

      await page.fill('#pf-captcha-input', '000000'); // near-certainly wrong
      await page.fill('#pf-wa-code', '123456');
      await page.check('#pf-consent');
      await page.click('#pf-btn-3');
      await page.waitForTimeout(1000);

      assert.ok(leadRequests.length >= 1 && leadRequests[0] !== 201, 'CAPTCHA incorrecto: /api/leads no responde 201 (lead no se inserta)');
      const stillStep3 = await page.isVisible('#pf-step-3:not(.pf-hidden)');
      assert.ok(stillStep3, 'CAPTCHA incorrecto no navega fuera del formulario');

      await page.waitForFunction(
        (prevSrc) => {
          const el = document.getElementById('pf-captcha-img-el');
          return !!(el && el.getAttribute('src') && el.getAttribute('src') !== prevSrc);
        },
        imgSrcBefore,
        { timeout: 10000 }
      );
      const imgSrcAfter = await page.getAttribute('#pf-captcha-img-el', 'src');
      assert.notStrictEqual(imgSrcAfter, imgSrcBefore, 'Tras error de CAPTCHA se solicita un nuevo challenge');

      await ctx.close();
    }

    /* ── Scenario: CAPTCHA correcto → lead exitoso (happy path real, QA DB) ──
     * The browser never learns the answer from /api/captcha/challenge (that
     * endpoint never reveals it, in Preview exactly as in Production). To
     * exercise a real successful submission in an E2E test, this test
     * itself seeds a challenge directly in the QA Neon database with a
     * known answer/hash (the same thing lib/captcha.js's createCaptchaChallenge
     * does, minus the plaintext leak), then uses Playwright request
     * interception to hand that specific challengeId to the page in place
     * of a real /api/captcha/challenge call. The actual validation that
     * follows (POST /api/leads) is 100% real against the real backend and
     * the real QA database — nothing about /api/leads or the CAPTCHA
     * consumption logic is mocked or bypassed. */
    {
      const { hashCaptchaAnswer, consumeCaptchaChallenge } = await import('../lib/captcha.js');
      const { neon } = await import('@neondatabase/serverless');
      const sql = neon(process.env.DATABASE_URL);
      const pool = new Pool({ connectionString: process.env.DATABASE_URL });

      const challengeId = crypto.randomUUID();
      const knownAnswer = '927415';
      const answerHash = hashCaptchaAnswer(process.env.CAPTCHA_PEPPER, challengeId, knownAnswer);
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
      await sql`INSERT INTO captcha_challenges (id, answer_hash, expires_at) VALUES (${challengeId}, ${answerHash}, ${expiresAt.toISOString()})`;

      const ctx = await newContext(browser);
      const page = await ctx.newPage();

      // Prevent the final WhatsApp redirect from actually navigating this
      // Playwright page away from the Preview — WhatsApp's number, message
      // and destination are untouched; we only stop the browser-level
      // navigation so the test can keep asserting after submit.
      await page.route('https://api.whatsapp.com/**', route => route.abort());

      // Hand the page our known challenge instead of a server-generated one.
      await page.route('**/api/captcha/challenge', route => route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ challengeId, image: STUB_CAPTCHA_SVG_DATA_URI, expiresAt: expiresAt.toISOString() })
      }));

      const phone = '5587650000'; // last4 = 0000, no NIP-validity date needed
      const email = `QA.E2E.${Date.now()}@Bait.Test`; // mixed case, trimmed to prove normalization

      await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });
      await fillStep1(page, { phone, nip: '1234' });
      await page.click('#pf-btn-1');
      await page.waitForTimeout(100);
      await page.fill('#pf-nombre', 'María');
      await page.fill('#pf-apellido', 'González');
      await page.fill('#pf-email', email);
      await page.click('#pf-btn-2');
      await waitForCaptchaImage(page); // our mocked /api/captcha/challenge resolves

      await page.fill('#pf-captcha-input', knownAnswer);
      await page.fill('#pf-wa-code', '654321');
      await page.check('#pf-consent');

      // waitForResponse must be armed before the click that triggers the
      // fetch, so it can't miss the response race that a passive listener +
      // fixed timeout was prone to under real network latency.
      const leadResponsePromise = page.waitForResponse(
        res => res.url().includes('/api/leads') && res.request().method() === 'POST',
        { timeout: 15000 }
      );
      await page.click('#pf-btn-3');
      const leadResponse = await leadResponsePromise;

      const finalStatus = leadResponse.status();
      assert.ok(finalStatus === 200 || finalStatus === 201, `CAPTCHA correcto → /api/leads responde éxito (200/201), obtuvo ${finalStatus}`);

      // Confirm the row landed in the real QA database, with email normalized.
      const rows = await pool.query('SELECT id, phone, email FROM leads WHERE phone = $1', [phone]);
      assert.strictEqual(rows.rows.length, 1, 'La fila del lead existe en QA Neon tras el submit real');
      assert.strictEqual(rows.rows[0].email, email.trim().toLowerCase(), 'El email persistido está normalizado (lowercase/trim)');

      const nipCols = await pool.query(`
        SELECT count(*)::int AS count FROM information_schema.columns
        WHERE table_schema='public' AND table_name='leads' AND column_name IN ('nip','nip_valid_until')
      `);
      assert.strictEqual(nipCols.rows[0].count, 0, 'NIP / nip_valid_until siguen sin existir como columnas tras un submit real');

      // Confirm the challenge was actually consumed by the real /api/leads path.
      const challengeRow = await pool.query('SELECT used_at FROM captcha_challenges WHERE id = $1', [challengeId]);
      assert.ok(challengeRow.rows[0] && challengeRow.rows[0].used_at, 'El challenge quedó marcado como usado por el backend real');

      // Replay with the same challenge/answer → must be rejected.
      const replay = await consumeCaptchaChallenge(sql, challengeId, knownAnswer);
      assert.strictEqual(replay.ok, false, 'Replay del challenge ya usado (vía backend real) → rechazado');
      assert.strictEqual(replay.error, 'captcha_used', 'Replay rechazado específicamente como captcha_used');

      // Cleanup this test's row so QA stays clean.
      await pool.query('DELETE FROM leads WHERE phone = $1', [phone]);
      await pool.query('DELETE FROM captcha_challenges WHERE id = $1', [challengeId]);
      await pool.end();

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
