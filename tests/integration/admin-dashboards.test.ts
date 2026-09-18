/**
 * tests/integration/admin-dashboards.test.ts
 *
 * Tableros /admin/marketing y /admin/logs/dashboard contra la rama Neon de
 * test (TEST_DATABASE_URL, sólo lectura): los Route Handlers reales devuelven
 * agregados coherentes y los componentes renderizan (SSR) con esa respuesta
 * sin NaN / undefined ni cifras inventadas cuando una fuente no existe.
 */
import { describe, test, expect, vi, beforeAll } from 'vitest';
import { NextRequest } from 'next/server';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';

const TEST_URL = process.env.TEST_DATABASE_URL;
if (!TEST_URL) throw new Error('[CONFIG FAILURE] TEST_DATABASE_URL requerida (rama Neon de test)');
process.env.APP_DATABASE_URL = TEST_URL;
delete process.env.DATABASE_URL;

// Sesión admin simulada: la autorización real se prueba en admin-rbac.test.ts
vi.mock('@/lib/session', () => ({
  requireAdminSession: vi.fn(async () => ({ userId: 'test', email: 'qa@test', name: 'QA', role: 'Administrador' })),
}));

type Json = Record<string, unknown>;
const get = async (mod: { GET: (r: NextRequest) => Promise<Response> }, path: string) => {
  const res = await mod.GET(new NextRequest(`http://localhost${path}`));
  return { status: res.status, json: (await res.json()) as Json };
};

let marketingRoute: { GET: (r: NextRequest) => Promise<Response> };
let logsRoute: { GET: (r: NextRequest) => Promise<Response> };
beforeAll(async () => {
  marketingRoute = await import('@/app/api/admin/marketing/route');
  logsRoute = await import('@/app/api/admin/logs/metrics/route');
});

describe('GET /api/admin/marketing', () => {
  test('agregados coherentes para cada rango y región', async () => {
    for (const range of ['7d', '30d', '90d', 'ytd']) {
      for (const region of ['todas', 'cdmx', 'norte']) {
        const { status, json } = await get(marketingRoute, `/api/admin/marketing?range=${range}&region=${region}`);
        expect(status, `${range}/${region}`).toBe(200);
        const r = json.range as { id: string; days: number };
        expect(r.id).toBe(range);
        const trend = json.trend as { current: { leads: number }[]; prior: { leads: number }[] };
        expect(trend.current).toHaveLength(r.days);
        expect(trend.prior).toHaveLength(r.days);
        const channels = json.channels as { id: string; leads: number; sales: number; spend: number | null }[];
        expect(channels.map((c) => c.id)).toEqual(['google_ads', 'meta_ads', 'organic', 'other']);
        // la suma de leads por canal coincide con la suma de la tendencia diaria
        const byChannel = channels.reduce((a, c) => a + c.leads, 0);
        const byDay = trend.current.reduce((a, p) => a + p.leads, 0);
        expect(byChannel).toBe(byDay);
        const heat = json.heatmap as number[][];
        expect(heat).toHaveLength(7);
        heat.forEach((row) => expect(row).toHaveLength(8));
        expect(heat.flat().reduce((a, b) => a + b, 0)).toBe(byChannel);
        // ventas nunca superan leads; sin fuente de gasto → null, jamás 0 inventado
        channels.forEach((c) => expect(c.sales).toBeLessThanOrEqual(c.leads));
        expect(channels.find((c) => c.id === 'meta_ads')!.spend).toBeNull();
        const integ = json.integrations as { metaAds: boolean; searchConsole: boolean; googleAds: { hasData: boolean } };
        expect(integ.metaAds).toBe(false);
        expect(integ.searchConsole).toBe(false);
        if (!integ.googleAds.hasData) expect(channels.find((c) => c.id === 'google_ads')!.spend).toBeNull();
      }
    }
  });

  test('rango/región inválidos caen al default sin romper', async () => {
    const { status, json } = await get(marketingRoute, '/api/admin/marketing?range=constructor&region=toString');
    expect(status).toBe(200);
    expect((json.range as { id: string }).id).toBe('30d');
    expect((json.region as { id: string }).id).toBe('todas');
  });

  test('las pestañas renderizan con la respuesta real, sin NaN ni undefined', async () => {
    const { json } = await get(marketingRoute, '/api/admin/marketing?range=30d&region=todas');
    const M = await import('@/components/admin/MarketingClient');
    const data = json as unknown as import('@/components/admin/MarketingClient').Marketing;
    const D = M.deriveMarketing(data);
    const hasAds = data.integrations.googleAds.hasData;
    const html = [
      renderToString(createElement(M.ExecTab, { data, D, hasAds, days: data.range.days, regionLabel: 'todas las regiones' })),
      renderToString(createElement(M.SeoTab, { data, D })),
      renderToString(createElement(M.SemTab, { D, hasAds, configured: data.integrations.googleAds.configured })),
      renderToString(createElement(M.GoogleTab, { data, D, hasAds, configured: data.integrations.googleAds.configured })),
      renderToString(createElement(M.FacebookTab, { data, D })),
    ].join('\n');
    expect(html).not.toMatch(/NaN|undefined|\$Infinity/);
    expect(html).toContain('Lectura del período');
    expect(html).toContain('Resumen por canal');
    // Fuentes inexistentes → estado honesto, nunca cifras
    expect(html).toContain('Search Console no conectado');
    expect(html).toContain('Meta Marketing API');
    if (!hasAds) expect(html).toContain('Sin inversión registrada');
  });
});

describe('GET /api/admin/logs/metrics', () => {
  test('conteos, serie y distribución de intentos cuadran', async () => {
    for (const range of ['hoy', '7d', '30d', 'all']) {
      const { status, json } = await get(logsRoute, `/api/admin/logs/metrics?range=${range}`);
      expect(status, range).toBe(200);
      expect(json.range).toBe(range);
      expect(json.bucket).toBe(range === 'hoy' ? 'hour' : range === 'all' ? 'week' : 'day');
      const counts = json.counts as Record<string, number>;
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      expect(json.total).toBe(total);
      const series = json.series as { ok: number; bad: number; total: number }[];
      expect(series.reduce((a, s) => a + s.total, 0)).toBe(total);
      expect(series.reduce((a, s) => a + s.ok, 0)).toBe(counts.delivered);
      expect(series.reduce((a, s) => a + s.bad, 0)).toBe(counts.failed + counts.dead);
      const attempts = json.attempts as { attempts: number; n: number }[];
      expect(attempts).toHaveLength((json.maxAttempts as number) + 1);
      expect(attempts.reduce((a, x) => a + x.n, 0)).toBe(total);
      const errors = json.errors as { n: number }[];
      expect(errors.reduce((a, e) => a + e.n, 0)).toBeLessThanOrEqual(counts.failed + counts.dead);
      const avg = json.attemptsAvg as number;
      expect(Number.isFinite(avg)).toBe(true);
    }
  });
});
