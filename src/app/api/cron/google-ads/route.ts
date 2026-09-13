import { NextResponse } from 'next/server';
import { getDb, schema } from '@/db';
import { logError } from '@/lib/log';
import { getGoogleAdsConfig } from '@/lib/integrations/config';
import { createGoogleAdsCustomer } from '@/lib/integrations/google-ads';

export const runtime = 'nodejs';
// Vercel Cron
export const maxDuration = 60; 

/**
 * Función CRON para extraer métricas diarias de Google Ads (SEM).
 * Se ejecuta automáticamente según vercel.json.
 */
export async function GET(req: Request) {
  try {
    // FLW-005: fail-closed sobre CRON_SECRET
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      logError('/api/cron/google-ads', 'config', new Error('CRON_SECRET missing'));
      return NextResponse.json({ error: 'Configuración incompleta.' }, { status: 503 });
    }
    if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
    }

    const db = getDb();

    // 1. Credenciales desde /admin/settings (fallback env)
    const cfg = await getGoogleAdsConfig();
    if (!cfg) {
      return NextResponse.json({ message: 'Google Ads no está configurado (developer token, OAuth client, refresh token o customer id).' }, { status: 200 });
    }
    const keywordFilter = cfg.campaignFilter;

    // 2. Consulta GQL (Google Ads Query Language)
    // Extraemos rendimiento de campañas de los últimos 30 días
    let query = `
      SELECT
        campaign.id,
        campaign.name,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        segments.date
      FROM campaign
      WHERE segments.date DURING LAST_30_DAYS
    `;

    if (keywordFilter && keywordFilter.trim() !== '') {
      query += ` AND campaign.name LIKE '%${keywordFilter.trim()}%'`;
    }

    // 3. Cliente
    const customer = createGoogleAdsCustomer(cfg);

    // 4. Extraer datos con GAQL
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let rows: any[] = [];
    try {
      rows = await customer.query(query);
    } catch (err: unknown) {
      console.error('Google Ads API Error:', err);
      const error = err as { message: string, errors?: { message: string }[] };
      let errMsg = error.message;
      if (error.errors && error.errors.length > 0) {
        errMsg = error.errors[0].message;
      }
      throw new Error(`Google Ads API error: ${errMsg}`);
    }

    let inserted = 0;

    // 4. Guardar métricas en la base de datos (Upsert)
    for (const row of rows) {
      const { campaign, metrics, segments } = row;
      if (!campaign || !metrics || !segments) continue;

      const dateObj = new Date(segments.date); // 'YYYY-MM-DD'
      const dateStr = dateObj.toISOString().split('T')[0];
      
      await db.insert(schema.adsMetrics)
        .values({
          date: dateStr,
          campaignId: campaign.id,
          campaignName: campaign.name,
          impressions: parseInt(metrics.impressions || '0', 10),
          clicks: parseInt(metrics.clicks || '0', 10),
          costMicros: parseInt(metrics.cost_micros || '0', 10),
          conversions: metrics.conversions || '0',
        })
        .onConflictDoUpdate({
          target: [schema.adsMetrics.date, schema.adsMetrics.campaignId],
          set: {
            campaignName: campaign.name,
            impressions: parseInt(metrics.impressions || '0', 10),
            clicks: parseInt(metrics.clicks || '0', 10),
            costMicros: parseInt(metrics.cost_micros || '0', 10),
            conversions: metrics.conversions || '0',
            updatedAt: new Date(),
          }
        });
      
      inserted++;
    }

    return NextResponse.json({
      success: true,
      message: `Extraídas ${inserted} métricas de campañas de Google Ads.`,
    });

  } catch (error: unknown) {
    const err = error as Error;
    logError('/api/cron/google-ads', 'GET', err);
    return NextResponse.json(
      { error: 'Falló la extracción de métricas', details: err.message },
      { status: 500 }
    );
  }
}
