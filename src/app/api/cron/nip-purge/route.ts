import { NextRequest, NextResponse } from 'next/server';
import { getDb, schema } from '@/db';
import { lt } from 'drizzle-orm';
import { purgeExpiredRateLimits } from '@/lib/security/rate-limiter';
import { purgeExpiredCaptchaChallenges } from '@/lib/security/captcha';
import { logError } from '@/lib/log';

// ── Cron: purga de lead_secrets vencidos (vacío en BAIT Prepago: el NIP no se
// persiste) + buckets de rate limit + retos CAPTCHA expirados ─────────────────
// FLW-005: fail-closed sobre CRON_SECRET.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    logError('/api/cron/nip-purge', 'config', new Error('CRON_SECRET missing'));
    return NextResponse.json({ error: 'Configuración incompleta.' }, { status: 503 });
  }
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
  }

  try {
    const db = getDb();
    const now = new Date();
    await db.delete(schema.leadSecrets).where(lt(schema.leadSecrets.expiresAt, now));
    const rateLimitsPurged = await purgeExpiredRateLimits();
    const captchaPurged = await purgeExpiredCaptchaChallenges();

    return NextResponse.json({ ok: true, purgedAt: now.toISOString(), rateLimitsPurged, captchaPurged });
  } catch (err) {
    logError('/api/cron/nip-purge', 'purge', err);
    return NextResponse.json({ error: 'Error en purge.' }, { status: 500 });
  }
}
