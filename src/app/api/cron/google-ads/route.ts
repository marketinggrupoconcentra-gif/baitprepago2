import { NextResponse } from 'next/server';
import { getDb, schema } from '@/db';
import { getSetting } from '@/lib/settings';
import { logError } from '@/lib/log';
import { GoogleAdsApi } from 'google-ads-api';

export const runtime = 'nodejs';
// Vercel Cron
export const maxDuration = 60; 

/**
 * Función CRON para extraer métricas diarias de Google Ads (SEM).
 * Se ejecuta automáticamente según vercel.json.
 */
export async function GET(req: Request) {
  try {
    // Validar autorización del CRON de Vercel
    const authHeader = req.headers.get('authorization');
    if (
      process.env.NODE_ENV === 'production' &&
      authHeader !== `Bearer ${process.env.CRON_SECRET}`
    ) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = getDb();

    // 1. Obtener credenciales de la configuración (Base de Datos o Env)
    const accountId = await getSetting('google_ads_account_id', process.env.GOOGLE_ADS_ACCOUNT_ID);
    // Ya no usamos un token estático. Vamos a usar la variable base64 y el developer token.
    const keywordFilter = await getSetting('google_ads_campaign_filter', process.env.GOOGLE_ADS_CAMPAIGN_FILTER);
    
    // El JSON descargado inyectado en Base64
    const b64Credentials = process.env.GOOGLE_ADS_CREDENTIALS_B64;
    // Developer Token de Google Ads (requerido siempre)
    const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;

    if (!accountId || !b64Credentials || !developerToken) {
      return NextResponse.json(
        { message: 'Google Ads no está completamente configurado (faltan account_id, developer_token o credentials_b64).' },
        { status: 200 } 
      );
    }

    // Limpiar el account ID (remover guiones y espacios)
    const cleanAccountId = accountId.replace(/-/g, '').trim();

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

    // 3. Obtener credenciales y configurar cliente
    let credentials;
    try {
      credentials = JSON.parse(b64Credentials);
    } catch (e) {
      const decodedCredentials = Buffer.from(b64Credentials, 'base64').toString('utf-8');
      credentials = JSON.parse(decodedCredentials);
    }

    const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN;
    if (!refreshToken) {
      throw new Error('Falta GOOGLE_ADS_REFRESH_TOKEN en el entorno.');
    }

    const clientId = credentials.installed ? credentials.installed.client_id : credentials.client_id;
    const clientSecret = credentials.installed ? credentials.installed.client_secret : credentials.client_secret;

    const client = new GoogleAdsApi({
      client_id: clientId,
      client_secret: clientSecret,
      developer_token: developerToken,
    });

    const customer = client.Customer({
      customer_id: cleanAccountId,
      refresh_token: refreshToken,
    });

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
