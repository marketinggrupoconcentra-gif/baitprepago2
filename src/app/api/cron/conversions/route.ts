import { NextRequest, NextResponse } from 'next/server';
import { processConversionQueue } from '@/lib/conversions/queue';
import { logError } from '@/lib/log';

// ── Cron: envío de conversiones a Google Ads (offline) y Meta CAPI ───────────
// Lee app.conversion_deliveries en estado pending y reintenta con backoff.
// Fail-closed sobre CRON_SECRET (mismo patrón que el resto de crons).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    logError('/api/cron/conversions', 'config', new Error('CRON_SECRET missing'));
    return NextResponse.json({ error: 'Configuración incompleta.' }, { status: 503 });
  }
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
  }

  try {
    const summary = await processConversionQueue();
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    logError('/api/cron/conversions', 'run', err);
    return NextResponse.json({ error: 'Error procesando conversiones.' }, { status: 500 });
  }
}
