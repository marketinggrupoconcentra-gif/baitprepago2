/**
 * tests/unit/conversions.test.ts — Normalización/hash para Google Ads y Meta CAPI
 * (funciones puras; el envío real se prueba con las credenciales en Preview).
 */
import { describe, test, expect } from 'vitest';
import { createHash } from 'crypto';
import { hashedEmailForMeta, hashedPhoneForMeta, fbcFromClickId } from '../../src/lib/integrations/meta-capi';
import { hashedEmailForGoogle, hashedPhoneForGoogle, toGoogleAdsDateTime } from '../../src/lib/integrations/google-ads';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

describe('Meta CAPI — normalización', () => {
  test('email: trim + minúsculas antes del SHA-256', () => {
    expect(hashedEmailForMeta('  Prueba@Example.COM ')).toBe(sha('prueba@example.com'));
  });
  test('teléfono mexicano de 10 dígitos → 52 + dígitos', () => {
    expect(hashedPhoneForMeta('55 1234 5678')).toBe(sha('525512345678'));
    expect(hashedPhoneForMeta('+52 55 1234 5678')).toBe(sha('525512345678'));
  });
  test('fbc sintetizado a partir del fbclid', () => {
    expect(fbcFromClickId('IwAR0abc', new Date(1757770000000))).toBe('fb.1.1757770000000.IwAR0abc');
  });
});

describe('Google Ads — normalización', () => {
  test('email y teléfono E.164 hasheados', () => {
    expect(hashedEmailForGoogle(' A@B.com')).toBe(sha('a@b.com'));
    expect(hashedPhoneForGoogle('5512345678')).toBe(sha('+525512345678'));
  });
  test('formato de fecha yyyy-mm-dd hh:mm:ss+00:00', () => {
    expect(toGoogleAdsDateTime(new Date('2026-09-13T15:44:32.123Z'))).toBe('2026-09-13 15:44:32+00:00');
  });
});
