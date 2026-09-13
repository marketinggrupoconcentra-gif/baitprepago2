/**
 * src/lib/email/report-template.ts
 *
 * Template HTML/texto del reporte periódico de leads BAIT Prepago
 * (cron /api/cron/reports). Diseño responsive, compatible con clientes de email.
 *
 * NUNCA incluir: NIP, password, datos cifrados, IP, tokens, PII raw no solicitada.
 */

export interface ReportData {
  periodLabel: string;       // "07 Sep 2026 — 08 Sep 2026"
  frequency: string;         // "Diario" | "Semanal" | "Mensual"
  totalLeads: number;
  bySource: Array<{ sourceCategory: string; count: number }>;
  byCommercial: Array<{ status: string; count: number }>;
  generatedAt: string;       // fecha/hora legible en CDMX
}

const SOURCE_LABELS: Record<string, string> = {
  google_ads: 'Google Ads',
  meta_ads: 'Meta Ads',
  paid_other: 'Pago otro',
  organic: 'Orgánico',
  referral: 'Referral',
  direct: 'Directo',
  other: 'Otro',
};

const COMMERCIAL_LABELS: Record<string, string> = {
  NEW:       'Nuevo',
  CONTACTED: 'Contactado',
  FOLLOW_UP: 'Seguimiento',
  WON:       'Ganado',
  LOST:      'Perdido',
};

const FREQ_SUBJECTS: Record<string, string> = {
  DAILY:   'Corte Diario de Leads — BAIT Prepago',
  WEEKLY:  'Corte Semanal de Leads — BAIT Prepago',
  MONTHLY: 'Corte Mensual de Leads — BAIT Prepago',
};

export function buildReportSubject(frequency: string): string {
  return FREQ_SUBJECTS[frequency] ?? 'Reporte de Leads — BAIT Prepago';
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function tableRows(rows: Array<[string, number]>): string {
  return rows.map(([label, count]) => `
      <tr>
        <td style="padding:10px 16px; border-bottom:1px solid #f0f0f0; font-size:14px; color:#374151;">${escapeHtml(label)}</td>
        <td style="padding:10px 16px; border-bottom:1px solid #f0f0f0; font-size:14px; color:#374151; text-align:right; font-weight:600;">${count.toLocaleString('es-MX')}</td>
      </tr>`).join('');
}

function tableSection(title: string, firstHeader: string, rows: string): string {
  if (!rows) return '';
  return `
          <tr>
            <td style="background:#ffffff; padding:0 40px 24px;">
              <h2 style="font-size:15px; font-weight:700; color:#111827; margin:0 0 16px;">${title}</h2>
              <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb; border-radius:12px; overflow:hidden;">
                <tr>
                  <th style="padding:10px 16px; background:#f9fafb; text-align:left; font-size:12px; font-weight:700; color:#6b7280; text-transform:uppercase; letter-spacing:0.05em;">${firstHeader}</th>
                  <th style="padding:10px 16px; background:#f9fafb; text-align:right; font-size:12px; font-weight:700; color:#6b7280; text-transform:uppercase; letter-spacing:0.05em;">Leads</th>
                </tr>
                ${rows}
              </table>
            </td>
          </tr>`;
}

export function buildReportHtml(data: ReportData): string {
  const sourceRows = tableRows(data.bySource.map((s) => [SOURCE_LABELS[s.sourceCategory] ?? s.sourceCategory, s.count]));
  const commercialRows = tableRows(data.byCommercial.map((c) => [COMMERCIAL_LABELS[c.status] ?? c.status, c.count]));
  const won = data.byCommercial.find((c) => c.status === 'WON')?.count ?? 0;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reporte BAIT Prepago — ${escapeHtml(data.periodLabel)}</title>
</head>
<body style="margin:0; padding:0; background:#f6f7f9; font-family:system-ui,-apple-system,sans-serif; -webkit-font-smoothing:antialiased;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9; padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%;">

          <!-- Header -->
          <tr>
            <td style="background:#111827; border-radius:16px 16px 0 0; padding:32px 40px;">
              <p style="margin:0 0 8px; font-size:12px; font-weight:700; color:rgba(255,255,255,0.5); text-transform:uppercase; letter-spacing:0.08em;">BAIT PREPAGO</p>
              <h1 style="margin:0; font-size:24px; font-weight:800; color:#ffffff; letter-spacing:-0.02em;">Reporte ${escapeHtml(data.frequency)}</h1>
              <p style="margin:8px 0 0; font-size:14px; color:rgba(255,255,255,0.65);">${escapeHtml(data.periodLabel)}</p>
            </td>
          </tr>

          <!-- KPIs -->
          <tr>
            <td style="background:#ffffff; padding:32px 40px 24px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td width="50%" align="center" style="padding:0 8px 0 0;">
                    <div style="background:#f9fafb; border:1px solid #e5e7eb; border-radius:12px; padding:20px 16px;">
                      <div style="font-size:11px; font-weight:700; color:#6b7280; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:8px;">Leads recibidos</div>
                      <div style="font-size:28px; font-weight:800; color:#111827;">${data.totalLeads.toLocaleString('es-MX')}</div>
                    </div>
                  </td>
                  <td width="50%" align="center" style="padding:0 0 0 8px;">
                    <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:12px; padding:20px 16px;">
                      <div style="font-size:11px; font-weight:700; color:#16a34a; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:8px;">Portabilidades ganadas</div>
                      <div style="font-size:28px; font-weight:800; color:#15803d;">${won.toLocaleString('es-MX')}</div>
                    </div>
                  </td>
                </tr>
              </table>
              ${data.totalLeads === 0 ? '<p style="margin:16px 0 0; font-size:13px; color:#6b7280; text-align:center;">Sin leads en el período.</p>' : ''}
            </td>
          </tr>
${tableSection('Leads por fuente', 'Fuente', sourceRows)}
${tableSection('Estado comercial', 'Estado', commercialRows)}
          <!-- Footer -->
          <tr>
            <td style="background:#f9fafb; border-radius:0 0 16px 16px; padding:24px 40px; border-top:1px solid #e5e7eb;">
              <p style="margin:0; font-size:12px; color:#9ca3af; text-align:center;">
                Reporte generado el ${escapeHtml(data.generatedAt)} (Ciudad de México)<br>
                BAIT Prepago — Reporte Interno Confidencial — No Redistribuir
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function buildReportText(data: ReportData): string {
  const won = data.byCommercial.find((c) => c.status === 'WON')?.count ?? 0;
  const lines = [
    `BAIT PREPAGO — REPORTE ${data.frequency.toUpperCase()}`,
    `Período: ${data.periodLabel}`,
    '',
    'KPIs:',
    `  Leads recibidos:          ${data.totalLeads}`,
    `  Portabilidades ganadas:   ${won}`,
    '',
  ];

  if (data.bySource.length > 0) {
    lines.push('Leads por fuente:');
    data.bySource.forEach((s) => lines.push(`  ${SOURCE_LABELS[s.sourceCategory] ?? s.sourceCategory}: ${s.count}`));
    lines.push('');
  }

  if (data.byCommercial.length > 0) {
    lines.push('Estado comercial:');
    data.byCommercial.forEach((c) => lines.push(`  ${COMMERCIAL_LABELS[c.status] ?? c.status}: ${c.count}`));
    lines.push('');
  }

  lines.push(`Generado: ${data.generatedAt} (CDMX)`);
  lines.push('Reporte Interno Confidencial — No Redistribuir');

  return lines.join('\n');
}
