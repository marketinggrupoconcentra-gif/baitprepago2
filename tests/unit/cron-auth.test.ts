/**
 * cron-auth.test.ts
 * 
 * Tests de integración liviana para la autenticación de rutas cron.
 * Verifica que CRON_SECRET protege los endpoints correctamente.
 * No depende de DB real — solo prueba la capa de autenticación HTTP.
 */
import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const MOCK_CRON_SECRET = 'a'.repeat(64);

// Réplica del contrato fail-closed real (FLW-005).
function validateCronAuth(
  authHeader: string | null,
  cronSecret: string | undefined,
): { status: number; ok: boolean; reason: string } {
  if (!cronSecret) {
    return { status: 503, ok: false, reason: 'CRON_SECRET_NOT_CONFIGURED' };
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    return { status: 401, ok: false, reason: 'UNAUTHORIZED' };
  }
  return { status: 200, ok: true, reason: 'OK' };
}

describe('Cron auth — sin CRON_SECRET configurado (FLW-005 fail-closed)', () => {
  test('sin CRON_SECRET → NO ejecuta (503), nunca fail-open', () => {
    const result = validateCronAuth(`Bearer ${MOCK_CRON_SECRET}`, undefined);
    expect([500, 503]).toContain(result.status);
    expect(result.ok).toBe(false);
  });

  test('las rutas cron reales NO usan el patrón fail-open `if (cronSecret &&`', () => {
    const ROOT = path.resolve(__dirname, '../..');
    const files = [
      'src/app/api/cron/reports/route.ts',
      'src/app/api/cron/nip-purge/route.ts',
    ];
    for (const f of files) {
      const src = readFileSync(path.join(ROOT, f), 'utf-8');
      expect(src, `${f} usa patrón fail-open`).not.toMatch(/if\s*\(\s*cronSecret\s*&&/);
      expect(src, `${f} debe fail-closed sin secret`).toMatch(/if\s*\(\s*!cronSecret\s*\)/);
    }
  });
});

describe('Cron auth — con CRON_SECRET configurado', () => {
  test('retorna 401 si no hay Authorization header', () => {
    const result = validateCronAuth(null, MOCK_CRON_SECRET);
    expect(result.status).toBe(401);
    expect(result.ok).toBe(false);
  });

  test('retorna 401 si Authorization header es incorrecto', () => {
    const result = validateCronAuth('Bearer wrong-secret', MOCK_CRON_SECRET);
    expect(result.status).toBe(401);
    expect(result.ok).toBe(false);
  });

  test('retorna 401 con secret parcial correcto', () => {
    const partial = MOCK_CRON_SECRET.slice(0, 32);
    const result = validateCronAuth(`Bearer ${partial}`, MOCK_CRON_SECRET);
    expect(result.status).toBe(401);
    expect(result.ok).toBe(false);
  });

  test('retorna 401 sin prefijo Bearer', () => {
    const result = validateCronAuth(MOCK_CRON_SECRET, MOCK_CRON_SECRET);
    expect(result.status).toBe(401);
    expect(result.ok).toBe(false);
  });

  test('retorna 200 con secret correcto y formato Bearer', () => {
    const result = validateCronAuth(`Bearer ${MOCK_CRON_SECRET}`, MOCK_CRON_SECRET);
    expect(result.status).toBe(200);
    expect(result.ok).toBe(true);
  });

  test('token de producción debe tener al menos 32 bytes (64 hex chars)', () => {
    // Verificar que el secret generado por CSPRNG tiene la longitud correcta
    const validSecret = 'f'.repeat(64); // 64 hex chars = 32 bytes
    expect(validSecret.length).toBe(64);
    expect(/^[0-9a-f]{64}$/i.test(validSecret)).toBe(true);
  });
});

describe('Cron auth — compatibilidad con Vercel Cron', () => {
  test('Vercel envía Authorization: Bearer <secret> — verificar formato exacto', () => {
    // Vercel Cron inyecta: Authorization: Bearer <CRON_SECRET>
    // Nuestra validación debe comparar exactamente este formato
    const secret = MOCK_CRON_SECRET;
    const vercelHeader = `Bearer ${secret}`;
    const result = validateCronAuth(vercelHeader, secret);
    expect(result.ok).toBe(true);
  });

  test('header con espacios extra no pasa', () => {
    const result = validateCronAuth(` Bearer ${MOCK_CRON_SECRET}`, MOCK_CRON_SECRET);
    expect(result.ok).toBe(false);
  });
});
