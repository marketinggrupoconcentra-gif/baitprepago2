/**
 * GET /api/admin/logs/metrics — Dashboard de entregas a Intelix
 *
 * Alimenta `/admin/logs/dashboard` (diseño "Métricas de Logs.dc.html").
 * Requiere: logs.view
 *
 * Todo sale de app.delivery_outbox (destination = 'intelix'): volumen por
 * estado, serie por día (entregado vs. falló/definitivo), causas de falla y
 * distribución de intentos. Sin datos sintéticos: si el rango está vacío,
 * las series vienen vacías. Timezone de negocio: America/Mexico_City.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb, BUSINESS_TIMEZONE } from '@/db/index';
import { requireAdminSession } from '@/lib/session';
import { sql } from 'drizzle-orm';
import { logError } from '@/lib/log';
import { MAX_ATTEMPTS } from '@/lib/outbox/claim';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TZ = BUSINESS_TIMEZONE;
const DAY_MS = 24 * 60 * 60 * 1000;
const RANGES = ['hoy', '7d', '30d', 'all'] as const;
type RangeId = (typeof RANGES)[number];

/** Inicio del día CDMX (UTC-6, sin DST). */
function startOfDayMx(d: Date): Date {
  const shifted = new Date(d.getTime() - 6 * 60 * 60 * 1000);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() + 6 * 60 * 60 * 1000);
}

function rangeStart(range: RangeId, now: Date): Date | null {
  if (range === 'hoy') return startOfDayMx(now);
  if (range === '7d') return new Date(startOfDayMx(now).getTime() - 6 * DAY_MS);
  if (range === '30d') return new Date(startOfDayMx(now).getTime() - 29 * DAY_MS);
  return null;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    await requireAdminSession('logs.view');
  } catch (res) {
    return res as NextResponse;
  }

  const now = new Date();
  const rangeParam = req.nextUrl.searchParams.get('range') ?? '7d';
  const range: RangeId = (RANGES as readonly string[]).includes(rangeParam) ? (rangeParam as RangeId) : '7d';
  const from = rangeStart(range, now);
  // Granularidad de la serie: hoy → por hora; 7d/30d → por día; todo → por semana.
  const bucket = range === 'hoy' ? 'hour' : range === 'all' ? 'week' : 'day';

  try {
    const db = getDb();
    const where = from
      ? sql`destination = 'intelix' AND created_at >= ${from}`
      : sql`destination = 'intelix'`;

    const bucketExpr =
      bucket === 'hour'
        ? sql`to_char(date_trunc('hour', created_at AT TIME ZONE ${TZ}), 'YYYY-MM-DD"T"HH24:00')`
        : bucket === 'week'
          ? sql`to_char(date_trunc('week', created_at AT TIME ZONE ${TZ}), 'YYYY-MM-DD')`
          : sql`to_char(date_trunc('day', created_at AT TIME ZONE ${TZ}), 'YYYY-MM-DD')`;

    const [statusRows, seriesRows, errorRows, attemptRows] = await Promise.all([
      db.execute(sql`
        SELECT status, count(*)::int AS n, coalesce(sum(attempts), 0)::int AS attempts_sum
        FROM app.delivery_outbox WHERE ${where}
        GROUP BY 1
      `),
      db.execute(sql`
        SELECT ${bucketExpr} AS bucket,
          count(*) FILTER (WHERE status = 'delivered')::int AS ok,
          count(*) FILTER (WHERE status IN ('failed', 'dead'))::int AS bad,
          count(*)::int AS total
        FROM app.delivery_outbox WHERE ${where}
        GROUP BY 1 ORDER BY 1
      `),
      db.execute(sql`
        SELECT coalesce(nullif(last_error_code, ''), 'sin_codigo') AS code, count(*)::int AS n
        FROM app.delivery_outbox WHERE ${where} AND status IN ('failed', 'dead')
        GROUP BY 1 ORDER BY 2 DESC LIMIT 8
      `),
      db.execute(sql`
        SELECT least(attempts, ${MAX_ATTEMPTS})::int AS attempts, count(*)::int AS n
        FROM app.delivery_outbox WHERE ${where}
        GROUP BY 1 ORDER BY 1
      `),
    ]);

    const rows = (r: unknown): Record<string, unknown>[] =>
      ((r as { rows?: unknown[] }).rows ?? (r as unknown[])) as Record<string, unknown>[];
    const num = (v: unknown) => Number(v) || 0;

    const counts: Record<string, number> = { delivered: 0, pending: 0, processing: 0, failed: 0, dead: 0 };
    let total = 0, attemptsSum = 0;
    for (const r of rows(statusRows)) {
      counts[String(r.status)] = num(r.n);
      total += num(r.n);
      attemptsSum += num(r.attempts_sum);
    }

    // Distribución de intentos: siempre 0..MAX_ATTEMPTS para que el gráfico no
    // "salte" entre rangos aunque un escalón no tenga filas.
    const attemptMap = new Map(rows(attemptRows).map((r) => [num(r.attempts), num(r.n)]));
    const attempts = Array.from({ length: MAX_ATTEMPTS + 1 }, (_, i) => ({ attempts: i, n: attemptMap.get(i) ?? 0 }));

    // Serie continua: días/horas sin filas se rellenan con 0 para que el eje del
    // gráfico cubra todo el rango (7 → 7 barras, 30 → 30, hoy → 24 horas).
    const seriesMap = new Map(rows(seriesRows).map((r) => [String(r.bucket), { ok: num(r.ok), bad: num(r.bad), total: num(r.total) }]));
    const buckets: string[] = [];
    if (bucket === 'day' && from) {
      const n = range === '7d' ? 7 : 30;
      for (let i = 0; i < n; i++) buckets.push(new Date(from.getTime() + i * DAY_MS - 6 * 60 * 60 * 1000).toISOString().slice(0, 10));
    } else if (bucket === 'hour' && from) {
      const day = new Date(from.getTime() - 6 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const lastHour = Math.floor((now.getTime() - from.getTime()) / (60 * 60 * 1000));
      for (let h = 0; h <= Math.min(23, lastHour); h++) buckets.push(`${day}T${String(h).padStart(2, '0')}:00`);
    } else {
      buckets.push(...seriesMap.keys());
    }
    const series = buckets.map((b) => ({ bucket: b, ...(seriesMap.get(b) ?? { ok: 0, bad: 0, total: 0 }) }));

    return NextResponse.json({
      range,
      bucket,
      period: { from: from ? from.toISOString() : null, to: now.toISOString() },
      updatedAt: now.toISOString(),
      maxAttempts: MAX_ATTEMPTS,
      counts,
      total,
      attemptsAvg: total ? attemptsSum / total : 0,
      series,
      errors: rows(errorRows).map((r) => ({ code: String(r.code), n: num(r.n) })),
      attempts,
    });
  } catch (err) {
    logError('/api/admin/logs/metrics', 'handler', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
