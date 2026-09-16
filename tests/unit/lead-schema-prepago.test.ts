/**
 * tests/unit/lead-schema-prepago.test.ts
 *
 * Contrato del formulario BAIT Prepago (public/assets/site.js) contra
 * src/lib/validators/lead-schema.ts: campos, regla de vigencia del NIP y
 * códigos de error compatibles con la landing.
 */
import { describe, test, expect } from 'vitest';
import { LeadInputSchema, leadErrorCodes, todayBusinessDate, isWithinNipValidityWindow } from '../../src/lib/validators/lead-schema';

const base = {
  phone: '5512345678',
  nip: '2468',
  nip_valid_until: null,
  nombre: 'Prueba',
  apellido: 'Unitaria',
  email: 'PRUEBA@Example.com',
  consent: true,
  captcha_challenge_id: '11111111-2222-4333-8444-555555555555',
  captcha_answer: '123456',
  utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null, utm_term: null,
  gclid: null, fbclid: null, fb_ad_id: null, fb_adset_id: null, fb_campaign_id: null,
  referrer: null,
  page_url: 'https://portabilidadbait.com/?utm_source=google',
  website: '',
  form_started_at: Date.now() - 10_000,
  idempotency_key: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  session_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeef',
};

describe('LeadInputSchema — payload real de la landing', () => {
  test('acepta el payload exacto que envía site.js y normaliza email/nombre', () => {
    const r = LeadInputSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.email).toBe('prueba@example.com');
    expect(r.data.utm_source).toBeUndefined();
    expect(r.data.consent).toBe(true);
  });

  test('rechaza campos desconocidos (strict)', () => {
    expect(LeadInputSchema.safeParse({ ...base, birthdate: '1990-01-01' }).success).toBe(false);
  });

  test('NIP == últimos 4 del teléfono exige nip_valid_until en ventana', () => {
    const same = { ...base, nip: '5678' };
    const r1 = LeadInputSchema.safeParse(same);
    expect(r1.success).toBe(false);
    if (!r1.success) expect(leadErrorCodes(r1.error.flatten().fieldErrors as never)).toContain('nip_valid_until_required');

    const r2 = LeadInputSchema.safeParse({ ...same, nip_valid_until: todayBusinessDate() });
    expect(r2.success).toBe(true);

    const r3 = LeadInputSchema.safeParse({ ...same, nip_valid_until: '2020-01-01' });
    expect(r3.success).toBe(false);
    if (!r3.success) expect(leadErrorCodes(r3.error.flatten().fieldErrors as never)).toContain('nip_valid_until_out_of_range');
  });

  test('códigos de error compatibles con la landing', () => {
    const r = LeadInputSchema.safeParse({ ...base, phone: '123', email: 'x', consent: false });
    expect(r.success).toBe(false);
    if (r.success) return;
    const codes = leadErrorCodes(r.error.flatten().fieldErrors as never);
    expect(codes).toEqual(expect.arrayContaining(['phone_invalid', 'email_invalid', 'consent_required']));
  });

  test('honeypot con valor → rechazado por el schema', () => {
    expect(LeadInputSchema.safeParse({ ...base, website: 'http://spam' }).success).toBe(false);
  });
});

describe('ventana de vigencia del NIP (CDMX)', () => {
  test('hoy y hoy+5 dentro; ayer y hoy+6 fuera', () => {
    const now = new Date('2026-09-13T18:00:00Z'); // 12:00 CDMX
    expect(todayBusinessDate(now)).toBe('2026-09-13');
    expect(isWithinNipValidityWindow('2026-09-13', now)).toBe(true);
    expect(isWithinNipValidityWindow('2026-09-18', now)).toBe(true);
    expect(isWithinNipValidityWindow('2026-09-12', now)).toBe(false);
    expect(isWithinNipValidityWindow('2026-09-19', now)).toBe(false);
  });
});
