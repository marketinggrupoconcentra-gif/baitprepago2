import { describe, test, expect } from 'vitest';
import { resolveSourceCategory, parseUtmParams, parseClickIds, extractReferrerHost } from '../../src/lib/attribution';

describe('resolveSourceCategory', () => {
  test('gclid → google_ads', () => {
    expect(resolveSourceCategory({ gclidPresent: true, gbraidPresent: false, wbraidPresent: false, fbclidPresent: false })).toBe('google_ads');
  });

  test('gbraid → google_ads', () => {
    expect(resolveSourceCategory({ gclidPresent: false, gbraidPresent: true, wbraidPresent: false, fbclidPresent: false })).toBe('google_ads');
  });

  test('fbclid → meta_ads', () => {
    expect(resolveSourceCategory({ gclidPresent: false, gbraidPresent: false, wbraidPresent: false, fbclidPresent: true })).toBe('meta_ads');
  });

  test('utm_medium=cpc sin gclid → paid_other', () => {
    expect(resolveSourceCategory({ gclidPresent: false, gbraidPresent: false, wbraidPresent: false, fbclidPresent: false, utmSource: 'bing', utmMedium: 'cpc' })).toBe('paid_other');
  });

  test('utm_medium=cpc con google source → google_ads', () => {
    expect(resolveSourceCategory({ gclidPresent: false, gbraidPresent: false, wbraidPresent: false, fbclidPresent: false, utmSource: 'google', utmMedium: 'cpc' })).toBe('google_ads');
  });

  test('referrer de google.com → organic', () => {
    expect(resolveSourceCategory({ gclidPresent: false, gbraidPresent: false, wbraidPresent: false, fbclidPresent: false, referrerHost: 'google.com' })).toBe('organic');
  });

  test('referrer externo → referral', () => {
    expect(resolveSourceCategory({ gclidPresent: false, gbraidPresent: false, wbraidPresent: false, fbclidPresent: false, referrerHost: 'someblog.com' })).toBe('referral');
  });

  test('sin nada → direct', () => {
    expect(resolveSourceCategory({ gclidPresent: false, gbraidPresent: false, wbraidPresent: false, fbclidPresent: false })).toBe('direct');
  });
});

describe('parseUtmParams', () => {
  test('parsea UTM params correctamente', () => {
    const result = parseUtmParams('https://example.com/?utm_source=google&utm_medium=cpc&utm_campaign=test');
    expect(result.utmSource).toBe('google');
    expect(result.utmMedium).toBe('cpc');
    expect(result.utmCampaign).toBe('test');
  });

  test('URL sin UTMs → objeto vacío', () => {
    const result = parseUtmParams('https://example.com/');
    expect(result.utmSource).toBeUndefined();
  });

  test('URL inválida → objeto vacío (no lanza)', () => {
    expect(() => parseUtmParams('not-a-url')).not.toThrow();
  });
});

describe('parseClickIds', () => {
  test('detecta gclid', () => {
    const r = parseClickIds('https://example.com/?gclid=123');
    expect(r.gclidPresent).toBe(true);
    expect(r.fbclidPresent).toBe(false);
  });

  test('detecta fbclid', () => {
    const r = parseClickIds('https://example.com/?fbclid=abc');
    expect(r.fbclidPresent).toBe(true);
    expect(r.gclidPresent).toBe(false);
  });
});

describe('extractReferrerHost', () => {
  test('extrae el host del referrer', () => {
    expect(extractReferrerHost('https://www.google.com/search?q=bait')).toBe('google.com');
  });

  test('referrer vacío → undefined', () => {
    expect(extractReferrerHost('')).toBeUndefined();
  });

  test('referrer inválido → undefined (no lanza)', () => {
    expect(extractReferrerHost('not-a-url')).toBeUndefined();
  });
});
