import { describe, test, expect } from 'vitest';
import { checkHoneypot, HONEYPOT_FIELD } from '../../src/lib/security/honeypot';
import { checkFormTiming } from '../../src/lib/security/timing';

// ── Honeypot ──────────────────────────────────────────────────────────────────
describe('checkHoneypot', () => {
  test('campo vacío → NOT bot', () => {
    expect(checkHoneypot({ [HONEYPOT_FIELD]: '' }).isBot).toBe(false);
  });

  test('campo ausente → NOT bot', () => {
    expect(checkHoneypot({}).isBot).toBe(false);
  });

  test('campo con valor → bot', () => {
    expect(checkHoneypot({ [HONEYPOT_FIELD]: 'http://spam.com' }).isBot).toBe(true);
  });

  test('campo null → NOT bot', () => {
    expect(checkHoneypot({ [HONEYPOT_FIELD]: null }).isBot).toBe(false);
  });
});

// ── Form Timing ───────────────────────────────────────────────────────────────
describe('checkFormTiming', () => {
  const MIN_MS = 4000;
  process.env.SECURITY_MIN_FORM_FILL_MS = String(MIN_MS);

  test('tiempo plausible (10 segundos) → pass', () => {
    const now = Date.now();
    const result = checkFormTiming(now - 10_000, now);
    expect(result.passed).toBe(true);
  });

  test('tiempo demasiado corto (1 segundo) → fail', () => {
    const now = Date.now();
    const result = checkFormTiming(now - 1_000, now);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('form_filled_too_fast');
  });

  test('sin timestamp → fail', () => {
    const result = checkFormTiming(null);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('missing_form_start_time');
  });

  test('timestamp del futuro → fail', () => {
    const now = Date.now();
    const result = checkFormTiming(now + 5000, now);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('invalid_form_start_time');
  });

  test('sesión de más de 2 horas → fail', () => {
    const now = Date.now();
    const result = checkFormTiming(now - 3 * 60 * 60 * 1000, now);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('form_session_expired');
  });
});
