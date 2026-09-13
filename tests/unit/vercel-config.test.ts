/**
 * vercel-config.test.ts
 * 
 * Valida que vercel.json tenga el schema correcto y no contenga properties inválidas.
 * Actúa como gate CI para prevenir regressions como el bug del campo "comment".
 */
import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const vercelJson = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../vercel.json'), 'utf-8')
);

describe('vercel.json schema validation', () => {
  test('debe ser un objeto válido', () => {
    expect(vercelJson).toBeDefined();
    expect(typeof vercelJson).toBe('object');
  });

  test('crons debe ser un array', () => {
    expect(Array.isArray(vercelJson.crons)).toBe(true);
  });

  test('cada cron debe tener SOLO path y schedule', () => {
    const ALLOWED_CRON_PROPS = new Set(['path', 'schedule']);
    for (const cron of vercelJson.crons) {
      const keys = Object.keys(cron);
      for (const key of keys) {
        expect(
          ALLOWED_CRON_PROPS.has(key),
          `Propiedad inválida en cron: "${key}". Solo se permiten: path, schedule`
        ).toBe(true);
      }
    }
  });

  test('cada cron debe tener path (string)', () => {
    for (const cron of vercelJson.crons) {
      expect(typeof cron.path).toBe('string');
      expect(cron.path.startsWith('/')).toBe(true);
    }
  });

  test('cada cron debe tener schedule (cron expression)', () => {
    // Validación básica: 5 campos separados por espacios
    const cronRegex = /^(\*|[\d,\-\/]+|\*\/\d+)\s+(\*|[\d,\-\/]+|\*\/\d+)\s+(\*|[\d,\-\/]+)\s+(\*|[\d,\-\/]+)\s+(\*|[\d,\-\/]+)$/;
    for (const cron of vercelJson.crons) {
      expect(
        cronRegex.test(cron.schedule),
        `Schedule inválido: "${cron.schedule}"`
      ).toBe(true);
    }
  });

  test('NIP purge debe correr a las 09:00 UTC (03:00 CDMX)', () => {
    const nipPurge = vercelJson.crons.find((c: { path: string }) => c.path === '/api/cron/nip-purge');
    expect(nipPurge).toBeDefined();
    // 0 9 * * * = cada día a las 09:00 UTC = 03:00 America/Mexico_City (UTC-6)
    expect(nipPurge.schedule).toBe('0 9 * * *');
  });

  test('outbox retry debe correr cada 5 minutos', () => {
    const outbox = vercelJson.crons.find((c: { path: string }) => c.path === '/api/cron/outbox');
    expect(outbox).toBeDefined();
    expect(outbox.schedule).toBe('*/5 * * * *');
  });

  test('NO debe contener campo "comment" en ningún cron', () => {
    for (const cron of vercelJson.crons) {
      expect(Object.keys(cron)).not.toContain('comment');
    }
  });

  test('reports debe correr a las 09:05 UTC (03:05 CDMX)', () => {
    const reports = vercelJson.crons.find((c: { path: string }) => c.path === '/api/cron/reports');
    expect(reports).toBeDefined();
    // 5 9 * * * = cada día a las 09:05 UTC = 03:05 America/Mexico_City
    expect(reports.schedule).toBe('5 9 * * *');
  });

  test('cron paths deben ser rutas reales de la API', () => {
    const expectedPaths = ['/api/cron/nip-purge', '/api/cron/outbox', '/api/cron/reports'];
    for (const expectedPath of expectedPaths) {
      const found = vercelJson.crons.some((c: { path: string }) => c.path === expectedPath);
      expect(found, `Ruta cron "${expectedPath}" no encontrada en vercel.json`).toBe(true);
    }
  });
});
