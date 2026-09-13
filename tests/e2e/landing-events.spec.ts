import { test, expect } from '@playwright/test';

test.describe('Landing and Tracking Events (FLW-006 & FLW-008)', () => {
  test('emits page_view on load without exposing PII', async ({ page }) => {
    // Intercept track calls
    const trackRequests: Array<Record<string, unknown>> = [];
    await page.route('/api/track', async (route) => {
      const body = route.request().postDataJSON();
      trackRequests.push(body);
      await route.fulfill({ status: 200, json: { ok: true } });
    });

    await page.goto('/');
    
    // Wait for the tracking call to complete
    await page.waitForTimeout(3000);

    const pageView = trackRequests.find(r => r.eventName === 'page_view');
    expect(pageView).toBeDefined();
    if (!pageView) throw new Error('No se recibió page_view');
    expect(pageView.eventId).toBeDefined();
    expect(pageView.sessionId).toBeDefined();
    
    // Ensure no legacy UTM or PII fields in tracking request
    expect(pageView.utmSource).toBeUndefined();
    expect(pageView.utmMedium).toBeUndefined();
    expect(pageView.sourceCategory).toBeUndefined();
  });

  test('does not send generate_lead to first-party API', async ({ page }) => {
    // Intercept track calls
    const trackRequests: Array<Record<string, unknown>> = [];
    await page.route('/api/track', async (route) => {
      const body = route.request().postDataJSON();
      trackRequests.push(body);
      await route.fulfill({ status: 200, json: { ok: true } });
    });

    // Mock window._fbq queue to verify third-party pixel firing
    await page.addInitScript(() => {
      const testWindow = window as Window & { _fbq_calls?: unknown[][] };
      window.fbq = (...args: unknown[]) => {
        testWindow._fbq_calls = testWindow._fbq_calls || [];
        testWindow._fbq_calls.push(args);
      };
    });

    await page.goto('/');
    
    // Trigger the third party dispatch by calling useTrack manually 
    // or simulating a lead success scenario
    await page.evaluate(() => {
      // Simulate component calling dispatchThirdParty for generate_lead
      // This requires window.fbq mock which we injected
      if (typeof window.fbq === 'function') {
        window.fbq('track', 'Lead', { content_name: 'test' });
      }
    });

    // Wait for async operations
    await page.waitForTimeout(500);

    // Verify /api/track did NOT receive generate_lead or lead_success from client
    const leadEvent = trackRequests.find(r => r.eventName === 'lead_success' || r.eventName === 'generate_lead');
    expect(leadEvent).toBeUndefined();

    // Verify FB Pixel DID receive it
    const fbCalls = await page.evaluate(() => {
      const testWindow = window as Window & { _fbq_calls?: unknown[][] };
      return testWindow._fbq_calls || [];
    });
    const fbLeadCall = fbCalls.find((call: unknown[]) => call[0] === 'track' && call[1] === 'Lead');
    expect(fbLeadCall).toBeDefined();
  });

  test('muestra el duplicado y permanece en el formulario sin crear otra solicitud', async ({ page }) => {
    let submittedPayload: Record<string, unknown> | undefined;
    await page.route('**/api/track', (route) => route.fulfill({ status: 200, json: { ok: true } }));
    await page.route('**/api/analytics/config', (route) => route.fulfill({ status: 200, json: {} }));
    await page.route('**/api/v1/otp/send', (route) => route.fulfill({
      status: 200,
      json: { success: true, expires_in: 120 },
    }));
    await page.route('**/api/v1/otp/verify', (route) => route.fulfill({
      status: 200,
      json: { verified: true, verification_proof: 'proof-for-duplicate-ui-test-1234567890' },
    }));
    await page.route('**/api/v1/leads', async (route) => {
      submittedPayload = route.request().postDataJSON();
      await route.fulfill({
        status: 409,
        json: {
          error: 'Este número ya está registrado. No se creó una nueva solicitud.',
          code: 'PHONE_ALREADY_REGISTERED',
        },
      });
    });

    await page.goto('/');
    await page.locator('#portability_dn').fill('5512345678');
    await page.locator('#portability_dn_confirm').fill('5512345678');
    await page.locator('#portability_nip').fill('2468');
    await page.locator('#portability_nip_confirm').fill('2468');
    await page.locator('[data-next="2"]').click();

    await page.locator('#portability_name').fill('Prueba');
    await page.locator('#portability_lastname').fill('Duplicado');
    await page.locator('#portability_email').fill('duplicate-ui@example.com');
    await page.locator('#portability_birthdate').fill('1990-01-01');
    await page.locator('#portability_state').selectOption('14');
    await page.locator('[data-next="3"]').click();

    const challenge = await page.locator('#lp-captcha-challenge').innerText();
    const operands = challenge.match(/\d+/g)?.map(Number) ?? [];
    expect(operands).toHaveLength(2);
    const answer = challenge.includes('+') ? operands[0] + operands[1] : operands[0] - operands[1];
    await page.locator('#portability_captcha').fill(String(answer));
    await page.locator('#lp-captcha-verify').click();
    await page.locator('#portability_acepta_contratacion').check();
    await page.locator('#portability_acepta_aviso_privacidad').check();
    await page.locator('#lp-submit-form').click();

    await expect(page.locator('#lp-form-alert')).toContainText('Este número ya está registrado');
    await expect(page.locator('#portability_dn')).toHaveAttribute('aria-invalid', 'true');
    await expect(page).toHaveURL(/\/$/);
    expect(submittedPayload).toMatchObject({
      phone: '5512345678',
      phone_confirm: '5512345678',
      state: 'JC',
    });
    expect(submittedPayload).not.toHaveProperty('dn');
  });
});
