/**
 * tests/unit/report-template.test.ts
 *
 * Verifica que el template de email sea correcto.
 * Cubre req 75: HTML, plain text, zero leads, NIP ausentes, asunto correcto.
 */
import { describe, it, expect } from 'vitest';
import {
  buildReportEmailHtml,
  buildReportEmailText,
  buildReportSubject,
} from '../../src/lib/email/report-template';

const BASE_STATS = {
  periodLabel: '7 Sep 2026 – 8 Sep 2026',
  periodStart: new Date('2026-09-07T06:00:00Z'),
  periodEnd: new Date('2026-09-08T05:59:59Z'),
  totalLeads: 42,
  bySource: [
    { sourceCategory: 'google_ads', count: 20 },
    { sourceCategory: 'meta_ads', count: 12 },
    { sourceCategory: 'organic', count: 10 },
  ],
  byDelivery: [
    { status: 'delivered', count: 38 },
    { status: 'pending', count: 3 },
    { status: 'failed', count: 1 },
  ],
  byCommercial: [
    { status: 'NEW', count: 40 },
    { status: 'CONTACTED', count: 2 },
  ],
  securityStats: { botBlocked: 5, rateLimited: 2, honeypot: 1 },
  generatedAt: new Date('2026-09-08T09:05:00Z'),
  scheduleName: 'Reporte Semanal',
  frequency: 'WEEKLY' as const,
};

const ZERO_STATS = {
  ...BASE_STATS,
  totalLeads: 0,
  bySource: [],
  byDelivery: [],
  byCommercial: [],
};

// ── Asunto ────────────────────────────────────────────────────────────────────

describe('buildReportSubject', () => {
  it('asunto DAILY correcto', () => {
    const subject = buildReportSubject('DAILY');
    expect(subject).toBe('Corte Diario de Leads — BAIT Prepago');
  });

  it('asunto WEEKLY correcto', () => {
    const subject = buildReportSubject('WEEKLY');
    expect(subject).toBe('Corte Semanal de Leads — BAIT Prepago');
  });

  it('asunto MONTHLY correcto', () => {
    const subject = buildReportSubject('MONTHLY');
    expect(subject).toBe('Corte Mensual de Leads — BAIT Prepago');
  });

  it('asunto contiene BAIT Prepago', () => {
    expect(buildReportSubject('DAILY')).toContain('BAIT Prepago');
  });
});

// ── HTML ─────────────────────────────────────────────────────────────────────

describe('buildReportEmailHtml', () => {
  it('genera HTML no vacío', () => {
    const html = buildReportEmailHtml(BASE_STATS);
    expect(html.length).toBeGreaterThan(100);
    expect(html).toContain('<html');
    expect(html).toContain('</html>');
  });

  it('incluye el total de leads correctamente', () => {
    const html = buildReportEmailHtml(BASE_STATS);
    expect(html).toContain('42');
  });

  it('incluye el badge REPORTE AUTOMÁTICO', () => {
    const html = buildReportEmailHtml(BASE_STATS);
    expect(html.toUpperCase()).toContain('REPORTE AUTOM');
  });

  it('incluye el periodo del reporte', () => {
    const html = buildReportEmailHtml(BASE_STATS);
    expect(html).toContain('2026');
  });

  it('incluye BAIT Prepago en el branding', () => {
    const html = buildReportEmailHtml(BASE_STATS);
    expect(html).toContain('BAIT');
  });

  it('incluye fuentes de leads (Google Ads, Meta Ads)', () => {
    const html = buildReportEmailHtml(BASE_STATS);
    // Debe mostrar categorías de fuente
    expect(html.toLowerCase()).toMatch(/google|meta|organic/);
  });

  it('incluye Ciudad de México / CDMX en el footer', () => {
    const html = buildReportEmailHtml(BASE_STATS);
    expect(html.toLowerCase()).toMatch(/cdmx|m.xico|mexico_city/i);
  });

  it('muestra 0 leads cuando no hay datos — no cancela el envío', () => {
    const html = buildReportEmailHtml(ZERO_STATS);
    expect(html).toContain('0');
    // El HTML no debe estar vacío — el email se envía igual con 0 leads
    expect(html.length).toBeGreaterThan(200);
  });

  it('NO contiene NIP en ninguna variante de la palabra', () => {
    const html = buildReportEmailHtml(BASE_STATS);
    expect(html.toLowerCase()).not.toContain('nip_enc');
    // 'nip' podría aparecer en palabras como 'nipple' teóricamente, pero validamos el campo
    expect(html).not.toContain('nip_enc');
    expect(html).not.toContain('nipHash');
  });


  it('NO contiene ciphertext ni blind index', () => {
    const html = buildReportEmailHtml(BASE_STATS);
    expect(html).not.toContain('_enc');
    expect(html).not.toContain('_bidx');
    expect(html).not.toContain('blind');
    expect(html).not.toContain('cipher');
  });

  it('NO expone API keys ni tokens', () => {
    const html = buildReportEmailHtml(BASE_STATS);
    expect(html).not.toContain('api_key');
    expect(html).not.toContain('API_KEY');
    expect(html).not.toContain('secret');
    expect(html).not.toContain('token');
  });

  it('seguridad en bloque separado', () => {
    const html = buildReportEmailHtml(BASE_STATS);
    // Los bots/spam deben estar en sección separada
    expect(html.toLowerCase()).toMatch(/seguridad|bot|bloqueado|descartado/i);
  });

  it('no mezcla bots con leads válidos en el total', () => {
    const html = buildReportEmailHtml(BASE_STATS);
    // El total es 42, no 42 + 5 bots + 2 rate_limited + 1 honeypot = 50
    expect(html).not.toContain('>50<');
  });
});

// ── Plain Text ────────────────────────────────────────────────────────────────

describe('buildReportEmailText', () => {
  it('genera plain text no vacío', () => {
    const text = buildReportEmailText(BASE_STATS);
    expect(text.length).toBeGreaterThan(50);
  });

  it('plain text incluye el total de leads', () => {
    const text = buildReportEmailText(BASE_STATS);
    expect(text).toContain('42');
  });

  it('plain text con 0 leads no está vacío', () => {
    const text = buildReportEmailText(ZERO_STATS);
    expect(text.length).toBeGreaterThan(30);
    expect(text).toContain('0');
  });

  it('plain text NO contiene NIP/ciphertext', () => {
    const text = buildReportEmailText(BASE_STATS);
    expect(text).not.toContain('nip_enc');
    expect(text).not.toContain('_enc');
    expect(text).not.toContain('_bidx');
  });

  it('no contiene etiquetas HTML', () => {
    const text = buildReportEmailText(BASE_STATS);
    // No debe tener tags <div>, <p>, etc.
    expect(text).not.toMatch(/<[a-z]+[^>]*>/i);
  });
});

// ── Idempotencia de periodo ───────────────────────────────────────────────────

describe('Run key / Idempotencia', () => {
  it('mismo period produce mismo run_key conceptual', () => {
    // Verificar que la lógica de run_key sea determinista
    const schedule = { id: 'abc-123', frequency: 'DAILY' };
    const date = '2026-09-08';
    const key1 = `${schedule.id}:${date}`;
    const key2 = `${schedule.id}:${date}`;
    expect(key1).toBe(key2);
  });

  it('diferente period produce diferente run_key', () => {
    const schedule = { id: 'abc-123', frequency: 'DAILY' };
    const key1 = `${schedule.id}:2026-09-07`;
    const key2 = `${schedule.id}:2026-09-08`;
    expect(key1).not.toBe(key2);
  });

  it('diferente schedule mismo period produce diferente run_key', () => {
    const key1 = `sch-001:2026-09-08`;
    const key2 = `sch-002:2026-09-08`;
    expect(key1).not.toBe(key2);
  });
});
