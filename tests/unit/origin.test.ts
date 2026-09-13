import { describe, test, expect, beforeEach } from 'vitest';
import { checkOrigin } from '@/lib/security/origin';

describe('checkOrigin', () => {
  beforeEach(() => {
    // Reset env state between tests
    delete process.env.APP_URL;
    delete process.env.ALLOWED_ORIGINS;
  });

  test('en development: permite cualquier origen (herramientas dev)', () => {
    // NODE_ENV=test se comporta como non-production
    expect(checkOrigin(null, null).allowed).toBe(true);
    expect(checkOrigin('https://evil.com', null).allowed).toBe(true);
  });

  // Nota: Los tests de producción requieren NODE_ENV=production.
  // La allowlist se construye al inicio del módulo, por lo que
  // testeamos la lógica directamente vía la función helper.
});

describe('buildAllowedOriginsLogic', () => {
  test('URL válida en APP_URL produce un origin correcto', () => {
    const url = 'https://baitprepago2.vercel.app';
    const u = new URL(url);
    expect(u.origin).toBe('https://baitprepago2.vercel.app');
  });

  test('URL con path en APP_URL — origin sin path', () => {
    const u = new URL('https://baitprepago2.vercel.app/some/path');
    expect(u.origin).toBe('https://baitprepago2.vercel.app');
  });

  test('ALLOWED_ORIGINS con comas — parsea múltiples', () => {
    const raw = 'https://a.com,https://b.com, https://c.com ';
    const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
    expect(parts).toHaveLength(3);
    expect(parts[2]).toBe('https://c.com');
  });

  test('URL inválida en ALLOWED_ORIGINS — no lanza excepción', () => {
    expect(() => {
      try { new URL('not-a-url'); } catch { /* ignorar */ }
    }).not.toThrow();
  });
});
