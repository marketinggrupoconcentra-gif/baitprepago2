/**
 * tests/unit/captcha.test.ts — CAPTCHA propio (src/lib/security/captcha.ts)
 * Funciones puras: hashing con pepper, render SVG sin <text>, fail-closed sin pepper.
 */
import { describe, test, expect } from 'vitest';
import { hashCaptchaAnswer, hashClientIdentifier, renderCaptchaSvg, toDataUri, getCaptchaPepper } from '../../src/lib/security/captcha';

describe('CAPTCHA — hashing', () => {
  test('mismo pepper+id+respuesta → mismo hash; distinta respuesta → distinto', () => {
    const a = hashCaptchaAnswer('pepper', 'id-1', '123456');
    expect(a).toBe(hashCaptchaAnswer('pepper', 'id-1', '123456'));
    expect(a).not.toBe(hashCaptchaAnswer('pepper', 'id-1', '654321'));
    expect(a).not.toBe(hashCaptchaAnswer('other', 'id-1', '123456'));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  test('client hash nunca contiene la IP en claro', () => {
    const h = hashClientIdentifier('pepper', '187.190.1.2');
    expect(h).not.toContain('187.190');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  test('sin CAPTCHA_PEPPER → lanza (fail closed)', () => {
    expect(() => getCaptchaPepper({} as NodeJS.ProcessEnv)).toThrow(/CAPTCHA_PEPPER/);
  });
});

describe('CAPTCHA — render', () => {
  test('el SVG no expone los dígitos como texto y es un data URI válido', () => {
    const svg = renderCaptchaSvg('123456');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).not.toMatch(/<text/);
    expect(svg).not.toContain('123456');
    const uri = toDataUri(svg);
    expect(uri.startsWith('data:image/svg+xml;base64,')).toBe(true);
    expect(Buffer.from(uri.split(',')[1], 'base64').toString('utf8')).toBe(svg);
  });
});
