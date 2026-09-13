/**
 * src/lib/email/report-template.ts
 *
 * Template HTML del reporte periódico de leads BAIT Prepago.
 * Diseño responsive, dark header, texto limpio, compatible con clientes de email.
 *
 * NUNCA incluir: NIP, password, datos cifrados, IP, tokens, PII raw no solicitada.
 */

// ── Legacy interface (cron Etapa 1) ──────────────────────────────────────────
interface ReportData {
  periodLabel: string;       // "07 Sep 2026 — 08 Sep 2026"
  frequency: string;         // "Diario" | "Semanal" | "Mensual"
  totalLeads: number;
  delivered: number;
  failed: number;
  duplicate: number;
  deliveryRate: number;      // 0-100
  byState: Array<{ stateCode: string; count: number }>;
  bySource: Array<{ sourceCategory: string; count: number }>;
  generatedAt: string;       // ISO datetime CDMX
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

export function buildReportHtml(data: ReportData): string {
  const stateRows = data.byState.slice(0, 10)
    .map(s => `
      <tr>
        <td style="padding:10px 16px; border-bottom:1px solid #f0f0f0; font-size:14px; color:#374151;">${s.stateCode}</td>
        <td style="padding:10px 16px; border-bottom:1px solid #f0f0f0; font-size:14px; color:#374151; text-align:right; font-weight:600;">${s.count.toLocaleString('es-MX')}</td>
      </tr>
    `).join('');

  const sourceRows = data.bySource
    .map(s => `
      <tr>
        <td style="padding:10px 16px; border-bottom:1px solid #f0f0f0; font-size:14px; color:#374151;">${SOURCE_LABELS[s.sourceCategory] ?? s.sourceCategory}</td>
        <td style="padding:10px 16px; border-bottom:1px solid #f0f0f0; font-size:14px; color:#374151; text-align:right; font-weight:600;">${s.count.toLocaleString('es-MX')}</td>
      </tr>
    `).join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reporte BAIT Prepago — ${data.periodLabel}</title>
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
              <h1 style="margin:0; font-size:24px; font-weight:800; color:#ffffff; letter-spacing:-0.02em;">Reporte ${data.frequency}</h1>
              <p style="margin:8px 0 0; font-size:14px; color:rgba(255,255,255,0.65);">${data.periodLabel}</p>
            </td>
          </tr>

          <!-- KPIs -->
          <tr>
            <td style="background:#ffffff; padding:32px 40px 24px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td width="25%" align="center" style="padding:0 8px 0 0;">
                    <div style="background:#f9fafb; border:1px solid #e5e7eb; border-radius:12px; padding:20px 16px;">
                      <div style="font-size:11px; font-weight:700; color:#6b7280; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:8px;">Total</div>
                      <div style="font-size:28px; font-weight:800; color:#111827;">${data.totalLeads.toLocaleString('es-MX')}</div>
                    </div>
                  </td>
                  <td width="25%" align="center" style="padding:0 8px;">
                    <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:12px; padding:20px 16px;">
                      <div style="font-size:11px; font-weight:700; color:#16a34a; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:8px;">Enviados</div>
                      <div style="font-size:28px; font-weight:800; color:#15803d;">${data.delivered.toLocaleString('es-MX')}</div>
                    </div>
                  </td>
                  <td width="25%" align="center" style="padding:0 8px;">
                    <div style="background:#fef2f2; border:1px solid #fecaca; border-radius:12px; padding:20px 16px;">
                      <div style="font-size:11px; font-weight:700; color:#dc2626; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:8px;">Fallidos</div>
                      <div style="font-size:28px; font-weight:800; color:#b91c1c;">${data.failed.toLocaleString('es-MX')}</div>
                    </div>
                  </td>
                  <td width="25%" align="center" style="padding:0 0 0 8px;">
                    <div style="background:#fefce8; border:1px solid #fde68a; border-radius:12px; padding:20px 16px;">
                      <div style="font-size:11px; font-weight:700; color:#ca8a04; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:8px;">Tasa</div>
                      <div style="font-size:28px; font-weight:800; color:#a16207;">${data.deliveryRate}%</div>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Por estado -->
          ${data.byState.length > 0 ? `
          <tr>
            <td style="background:#ffffff; padding:0 40px 24px;">
              <h2 style="font-size:15px; font-weight:700; color:#111827; margin:0 0 16px;">Leads por estado</h2>
              <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb; border-radius:12px; overflow:hidden;">
                <tr>
                  <th style="padding:10px 16px; background:#f9fafb; text-align:left; font-size:12px; font-weight:700; color:#6b7280; text-transform:uppercase; letter-spacing:0.05em;">Estado</th>
                  <th style="padding:10px 16px; background:#f9fafb; text-align:right; font-size:12px; font-weight:700; color:#6b7280; text-transform:uppercase; letter-spacing:0.05em;">Leads</th>
                </tr>
                ${stateRows}
              </table>
            </td>
          </tr>` : ''}

          <!-- Por fuente -->
          ${data.bySource.length > 0 ? `
          <tr>
            <td style="background:#ffffff; padding:0 40px 24px;">
              <h2 style="font-size:15px; font-weight:700; color:#111827; margin:0 0 16px;">Leads por fuente</h2>
              <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb; border-radius:12px; overflow:hidden;">
                <tr>
                  <th style="padding:10px 16px; background:#f9fafb; text-align:left; font-size:12px; font-weight:700; color:#6b7280; text-transform:uppercase; letter-spacing:0.05em;">Fuente</th>
                  <th style="padding:10px 16px; background:#f9fafb; text-align:right; font-size:12px; font-weight:700; color:#6b7280; text-transform:uppercase; letter-spacing:0.05em;">Leads</th>
                </tr>
                ${sourceRows}
              </table>
            </td>
          </tr>` : ''}

          <!-- Footer -->
          <tr>
            <td style="background:#f9fafb; border-radius:0 0 16px 16px; padding:24px 40px; border-top:1px solid #e5e7eb;">
              <p style="margin:0; font-size:12px; color:#9ca3af; text-align:center;">
                Reporte generado el ${data.generatedAt} (Ciudad de México)<br>
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
  const lines = [
    `BAIT PREPAGO — REPORTE ${data.frequency.toUpperCase()}`,
    `Período: ${data.periodLabel}`,
    '',
    'KPIs:',
    `  Total leads:    ${data.totalLeads}`,
    `  Enviados:       ${data.delivered}`,
    `  Fallidos:       ${data.failed}`,
    `  Duplicados:     ${data.duplicate}`,
    `  Tasa de envío:  ${data.deliveryRate}%`,
    '',
  ];

  if (data.byState.length > 0) {
    lines.push('Leads por estado:');
    data.byState.slice(0, 10).forEach(s => {
      lines.push(`  ${s.stateCode}: ${s.count}`);
    });
    lines.push('');
  }

  if (data.bySource.length > 0) {
    lines.push('Leads por fuente:');
    data.bySource.forEach(s => {
      lines.push(`  ${SOURCE_LABELS[s.sourceCategory] ?? s.sourceCategory}: ${s.count}`);
    });
    lines.push('');
  }

  lines.push(`Generado: ${data.generatedAt} (CDMX)`);
  lines.push('Reporte Interno Confidencial — No Redistribuir');

  return lines.join('\n');
}

// ── Etapa 2 interface — used by cron/reports + SettingsClient preview ─────────

export interface ReportStats {
  periodLabel: string;
  periodStart: Date;
  periodEnd: Date;
  totalLeads: number;
  bySource: Array<{ sourceCategory: string; count: number }>;
  byDelivery: Array<{ status: string; count: number }>;
  byCommercial: Array<{ status: string; count: number }>;
  securityStats: { botBlocked: number; rateLimited: number; honeypot: number };
  generatedAt: Date;
  scheduleName: string;
  frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY';
}

const FREQ_SUBJECTS: Record<string, string> = {
  DAILY:   'Corte Diario de Leads — BAIT Prepago',
  WEEKLY:  'Corte Semanal de Leads — BAIT Prepago',
  MONTHLY: 'Corte Mensual de Leads — BAIT Prepago',
};

export function buildReportSubject(frequency: string): string {
  return FREQ_SUBJECTS[frequency] ?? 'Reporte de Leads — BAIT Prepago';
}

const COMMERCIAL_LABELS: Record<string, string> = {
  NEW:       'Nuevo',
  CONTACTED: 'Contactado',
  FOLLOW_UP: 'Seguimiento',
  WON:       'Ganado',
  LOST:      'Perdido',
};

const DELIVERY_LABELS: Record<string, string> = {
  received:   'Recibido',
  processing: 'Procesando',
  delivered:  'Entregado',
  failed:     'Fallido',
  duplicate:  'Duplicado',
};

export function buildReportEmailHtml(stats: ReportStats): string {
  const generatedCdmx = stats.generatedAt.toLocaleString('es-MX', {
    timeZone: 'America/Mexico_City',
    dateStyle: 'long',
    timeStyle: 'short',
  });

  const sourceRows = stats.bySource.length > 0
    ? stats.bySource.map(s => `
      <tr>
        <td style="padding:10px 16px; border-bottom:1px solid #f0f0f0; font-size:14px; color:#374151;">${SOURCE_LABELS[s.sourceCategory] ?? s.sourceCategory}</td>
        <td style="padding:10px 16px; border-bottom:1px solid #f0f0f0; font-size:14px; color:#374151; text-align:right; font-weight:600;">${s.count.toLocaleString('es-MX')}</td>
      </tr>`).join('')
    : `<tr><td colspan="2" style="padding:16px; font-size:13px; color:#6b7280; text-align:center;">Sin registros en el período</td></tr>`;

  const deliveryRows = stats.byDelivery.map(d => `
    <tr>
      <td style="padding:10px 16px; border-bottom:1px solid #f0f0f0; font-size:14px; color:#374151;">${DELIVERY_LABELS[d.status] ?? d.status}</td>
      <td style="padding:10px 16px; border-bottom:1px solid #f0f0f0; font-size:14px; color:#374151; text-align:right; font-weight:600;">${d.count.toLocaleString('es-MX')}</td>
    </tr>`).join('');

  const commercialRows = stats.byCommercial.map(c => `
    <tr>
      <td style="padding:10px 16px; border-bottom:1px solid #f0f0f0; font-size:14px; color:#374151;">${COMMERCIAL_LABELS[c.status] ?? c.status}</td>
      <td style="padding:10px 16px; border-bottom:1px solid #f0f0f0; font-size:14px; color:#374151; text-align:right; font-weight:600;">${c.count.toLocaleString('es-MX')}</td>
    </tr>`).join('');

  const totalSecurity = stats.securityStats.botBlocked + stats.securityStats.rateLimited + stats.securityStats.honeypot;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${buildReportSubject(stats.frequency)}</title>
</head>
<body style="margin:0; padding:0; background:#f6f7f9; font-family:system-ui,-apple-system,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9; padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%;">
          <!-- Header -->
          <tr>
            <td style="background:#111827; border-radius:16px 16px 0 0; padding:32px 40px;">
              <p style="margin:0 0 4px; font-size:11px; font-weight:700; color:rgba(255,255,255,0.45); text-transform:uppercase; letter-spacing:0.1em;">REPORTE AUTOMÁTICO</p>
              <h1 style="margin:0; font-size:24px; font-weight:800; color:#ffffff; letter-spacing:-0.02em;">BAIT Prepago</h1>
              <p style="margin:8px 0 0; font-size:14px; color:rgba(255,255,255,0.65);">${stats.periodLabel}</p>
            </td>
          </tr>
          <!-- KPI total -->
          <tr>
            <td style="background:#ffffff; padding:32px 40px 24px;">
              <div style="background:#f9fafb; border:1px solid #e5e7eb; border-radius:12px; padding:24px 20px; text-align:center; display:inline-block; min-width:140px;">
                <div style="font-size:11px; font-weight:700; color:#6b7280; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:8px;">Total Leads</div>
                <div style="font-size:40px; font-weight:800; color:#111827;">${stats.totalLeads.toLocaleString('es-MX')}</div>
              </div>
            </td>
          </tr>
          <!-- Por fuente -->
          <tr>
            <td style="background:#ffffff; padding:0 40px 24px;">
              <h2 style="font-size:15px; font-weight:700; color:#111827; margin:0 0 12px;">Leads por fuente</h2>
              <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb; border-radius:12px; overflow:hidden;">
                <tr>
                  <th style="padding:10px 16px; background:#f9fafb; text-align:left; font-size:12px; font-weight:700; color:#6b7280; text-transform:uppercase;">Fuente</th>
                  <th style="padding:10px 16px; background:#f9fafb; text-align:right; font-size:12px; font-weight:700; color:#6b7280; text-transform:uppercase;">Leads</th>
                </tr>
                ${sourceRows}
              </table>
            </td>
          </tr>
          <!-- Estado de entrega -->
          ${deliveryRows ? `
          <tr>
            <td style="background:#ffffff; padding:0 40px 24px;">
              <h2 style="font-size:15px; font-weight:700; color:#111827; margin:0 0 12px;">Estado de entrega</h2>
              <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb; border-radius:12px; overflow:hidden;">
                <tr>
                  <th style="padding:10px 16px; background:#f9fafb; text-align:left; font-size:12px; font-weight:700; color:#6b7280; text-transform:uppercase;">Estado</th>
                  <th style="padding:10px 16px; background:#f9fafb; text-align:right; font-size:12px; font-weight:700; color:#6b7280; text-transform:uppercase;">Count</th>
                </tr>
                ${deliveryRows}
              </table>
            </td>
          </tr>` : ''}
          <!-- Estado comercial -->
          ${commercialRows ? `
          <tr>
            <td style="background:#ffffff; padding:0 40px 24px;">
              <h2 style="font-size:15px; font-weight:700; color:#111827; margin:0 0 12px;">Estado comercial</h2>
              <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb; border-radius:12px; overflow:hidden;">
                <tr>
                  <th style="padding:10px 16px; background:#f9fafb; text-align:left; font-size:12px; font-weight:700; color:#6b7280; text-transform:uppercase;">Estado</th>
                  <th style="padding:10px 16px; background:#f9fafb; text-align:right; font-size:12px; font-weight:700; color:#6b7280; text-transform:uppercase;">Count</th>
                </tr>
                ${commercialRows}
              </table>
            </td>
          </tr>` : ''}
          <!-- Seguridad — sección separada, nunca mezclada con leads válidos -->
          ${totalSecurity > 0 ? `
          <tr>
            <td style="background:#fff7ed; padding:20px 40px; border-top:2px solid #fed7aa;">
              <p style="margin:0 0 8px; font-size:12px; font-weight:700; color:#9a3412; text-transform:uppercase; letter-spacing:0.05em;">🛡 Tráfico descartado (seguridad — no incluido en leads)</p>
              <p style="margin:0; font-size:13px; color:#c2410c;">
                Bots bloqueados: ${stats.securityStats.botBlocked} &nbsp;·&nbsp;
                Rate limited: ${stats.securityStats.rateLimited} &nbsp;·&nbsp;
                Honeypot: ${stats.securityStats.honeypot}
              </p>
            </td>
          </tr>` : ''}
          <!-- Footer -->
          <tr>
            <td style="background:#f9fafb; border-radius:0 0 16px 16px; padding:24px 40px; border-top:1px solid #e5e7eb;">
              <p style="margin:0; font-size:12px; color:#9ca3af; text-align:center;">
                Generado el ${generatedCdmx} (CDMX / America/Mexico_City)<br>
                BAIT Prepago &nbsp;·&nbsp; Reporte Interno Confidencial &nbsp;·&nbsp; No redistribuir
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

export function buildReportEmailText(stats: ReportStats): string {
  const lines: string[] = [
    buildReportSubject(stats.frequency),
    `Período: ${stats.periodLabel}`,
    '',
    `Total de leads: ${stats.totalLeads}`,
    '',
  ];

  if (stats.bySource.length > 0) {
    lines.push('Leads por fuente:');
    stats.bySource.forEach(s => {
      lines.push(`  ${SOURCE_LABELS[s.sourceCategory] ?? s.sourceCategory}: ${s.count}`);
    });
    lines.push('');
  }

  if (stats.byDelivery.length > 0) {
    lines.push('Estado de entrega:');
    stats.byDelivery.forEach(d => {
      lines.push(`  ${DELIVERY_LABELS[d.status] ?? d.status}: ${d.count}`);
    });
    lines.push('');
  }

  if (stats.byCommercial.length > 0) {
    lines.push('Estado comercial:');
    stats.byCommercial.forEach(c => {
      lines.push(`  ${COMMERCIAL_LABELS[c.status] ?? c.status}: ${c.count}`);
    });
    lines.push('');
  }

  const totalSecurity = stats.securityStats.botBlocked + stats.securityStats.rateLimited + stats.securityStats.honeypot;
  if (totalSecurity > 0) {
    lines.push('--- Tráfico descartado (seguridad, NO incluido en leads) ---');
    lines.push(`  Bots bloqueados: ${stats.securityStats.botBlocked}`);
    lines.push(`  Rate limited:    ${stats.securityStats.rateLimited}`);
    lines.push(`  Honeypot:        ${stats.securityStats.honeypot}`);
    lines.push('');
  }

  lines.push(`Generado: ${stats.generatedAt.toISOString()} (CDMX)`);
  lines.push('Reporte Interno Confidencial — No redistribuir');

  return lines.join('\n');
}
