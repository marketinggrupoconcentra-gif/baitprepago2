/**
 * tests/unit/report-template.test.ts
 *
 * Verifica el template del reporte periódico (cron /api/cron/reports):
 * asunto, HTML, texto plano, período sin leads y ausencia de datos sensibles.
 */
import { describe, it, expect } from 'vitest';
import { buildReportHtml, buildReportText, buildReportSubject } from '../../src/lib/email/report-template';

const BASE: Parameters<typeof buildReportHtml>[0] = {
  periodLabel: '7 Sep 2026 — 8 Sep 2026',
  frequency: 'Semanal',
  totalLeads: 42,
  bySource: [
    { sourceCategory: 'google_ads', count: 20 },
    { sourceCategory: 'meta_ads', count: 12 },
    { sourceCategory: 'organic', count: 10 },
  ],
  byCommercial: [
    { status: 'NEW', count: 38 },
    { status: 'CONTACTED', count: 2 },
    { status: 'WON', count: 2 },
  ],
  generatedAt: '08/09/2026, 09:05',
};

const ZERO: typeof BASE = { ...BASE, totalLeads: 0, bySource: [], byCommercial: [] };

describe('buildReportSubject', () => {
  it('asuntos por frecuencia con la marca BAIT Prepago', () => {
    expect(buildReportSubject('DAILY')).toBe('Corte Diario de Leads — BAIT Prepago');
    expect(buildReportSubject('WEEKLY')).toBe('Corte Semanal de Leads — BAIT Prepago');
    expect(buildReportSubject('MONTHLY')).toBe('Corte Mensual de Leads — BAIT Prepago');
    expect(buildReportSubject('OTRA')).toContain('BAIT Prepago');
  });
});

describe('buildReportHtml', () => {
  it('es un documento HTML con periodo, total y ganados', () => {
    const html = buildReportHtml(BASE);
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('7 Sep 2026 — 8 Sep 2026');
    expect(html).toContain('Reporte Semanal');
    expect(html).toContain('>42<');
    expect(html).toContain('Portabilidades ganadas');
    expect(html).toContain('>2<');
  });

  it('lista fuentes y estados comerciales con etiquetas legibles', () => {
    const html = buildReportHtml(BASE);
    expect(html).toContain('Google Ads');
    expect(html).toContain('Meta Ads');
    expect(html).toContain('Orgánico');
    expect(html).toContain('Contactado');
    expect(html).toContain('Ganado');
  });

  it('sin leads: omite tablas y lo dice explícitamente', () => {
    const html = buildReportHtml(ZERO);
    expect(html).toContain('Sin leads en el período');
    expect(html).not.toContain('Leads por fuente');
    expect(html).not.toContain('Estado comercial');
  });

  it('escapa HTML en textos libres', () => {
    const html = buildReportHtml({ ...BASE, periodLabel: '<script>x</script>' });
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('no contiene NIP, contraseñas ni tokens', () => {
    const html = buildReportHtml(BASE).toLowerCase();
    for (const bad of ['nip', 'password', 'token', 'api_key']) expect(html).not.toContain(bad);
  });
});

describe('buildReportText', () => {
  it('texto plano con KPIs y desgloses', () => {
    const text = buildReportText(BASE);
    expect(text).toContain('BAIT PREPAGO — REPORTE SEMANAL');
    expect(text).toContain('Leads recibidos:          42');
    expect(text).toContain('Portabilidades ganadas:   2');
    expect(text).toContain('Google Ads: 20');
    expect(text).toContain('Ganado: 2');
    expect(text).not.toContain('<');
  });

  it('sin leads: solo KPIs en cero', () => {
    const text = buildReportText(ZERO);
    expect(text).toContain('Leads recibidos:          0');
    expect(text).not.toContain('Leads por fuente');
  });
});
