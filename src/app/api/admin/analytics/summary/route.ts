/**
 * GET /api/admin/analytics/summary — KPIs y leads en el tiempo
 *
 * Requiere: analytics.view permission
 * Solo datos reales de las tablas app.* — SIN inventar métricas.
 * Timezone: America/Mexico_City
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb, schema } from '@/db/index';
import { requireAdminSession } from '@/lib/session';
import { sql, and, gte, lt, eq, desc, isNotNull } from 'drizzle-orm';
import { BUSINESS_TIMEZONE } from '@/db/index';
import { logError } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseRange(dateFrom: string | null, dateTo: string | null): { from: Date; to: Date } {
  const now = new Date();
  // Default: últimos 30 días
  const from = dateFrom ? new Date(`${dateFrom}T00:00:00.000-06:00`) : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const to = dateTo ? new Date(new Date(`${dateTo}T00:00:00.000-06:00`).getTime() + 24 * 60 * 60 * 1000) : now;
  return { from, to };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  let session;
  try {
    session = await requireAdminSession('analytics.view');
  } catch (res) {
    return res as NextResponse;
  }
  void session;

  const url = req.nextUrl;
  const { from, to } = parseRange(
    url.searchParams.get('dateFrom'),
    url.searchParams.get('dateTo'),
  );

  try {
    const db = getDb();
    const period = and(gte(schema.leads.createdAt, from), lt(schema.leads.createdAt, to));

    const [
      totalsResult,
      byStatusResult,
      byStateResult,
      bySourceResult,
      byCampaignResult,
      byMediumResult,
      byCommercialStatusResult,
      timelineResult,
    ] = await Promise.all([
      // KPIs totales en el período
      db
        .select({
          total: sql<number>`count(*)::int`,
          delivered: sql<number>`count(*) filter (where ${schema.leads.status} = 'delivered')::int`,
          failed: sql<number>`count(*) filter (where ${schema.leads.status} = 'failed')::int`,
          duplicate: sql<number>`count(*) filter (where ${schema.leads.status} = 'duplicate')::int`,
        })
        .from(schema.leads)
        .where(period),

      // Por status
      db
        .select({
          status: schema.leads.status,
          count: sql<number>`count(*)::int`,
        })
        .from(schema.leads)
        .where(period)
        .groupBy(schema.leads.status)
        .orderBy(desc(sql`count(*)`)),

      // Por estado (top 10)
      db
        .select({
          stateCode: schema.leads.stateCode,
          count: sql<number>`count(*)::int`,
        })
        .from(schema.leads)
        .where(period)
        .groupBy(schema.leads.stateCode)
        .orderBy(desc(sql`count(*)`))
        .limit(10),

      // Por fuente (lead_attribution)
      db
        .select({
          sourceCategory: schema.leadAttribution.sourceCategory,
          count: sql<number>`count(*)::int`,
        })
        .from(schema.leads)
        .innerJoin(schema.leadAttribution, eq(schema.leads.id, schema.leadAttribution.leadId))
        .where(period)
        .groupBy(schema.leadAttribution.sourceCategory)
        .orderBy(desc(sql`count(*)`)),

      // Por Campaña (lead_attribution) Top 10
      db
        .select({
          campaign: schema.leadAttribution.firstUtmCampaign,
          count: sql<number>`count(*)::int`,
        })
        .from(schema.leads)
        .innerJoin(schema.leadAttribution, eq(schema.leads.id, schema.leadAttribution.leadId))
        .where(and(period, isNotNull(schema.leadAttribution.firstUtmCampaign)))
        .groupBy(schema.leadAttribution.firstUtmCampaign)
        .orderBy(desc(sql`count(*)`))
        .limit(10),

      // Por Medio (lead_attribution) Top 10
      db
        .select({
          medium: schema.leadAttribution.firstUtmMedium,
          count: sql<number>`count(*)::int`,
        })
        .from(schema.leads)
        .innerJoin(schema.leadAttribution, eq(schema.leads.id, schema.leadAttribution.leadId))
        .where(and(period, isNotNull(schema.leadAttribution.firstUtmMedium)))
        .groupBy(schema.leadAttribution.firstUtmMedium)
        .orderBy(desc(sql`count(*)`))
        .limit(10),

      // Por Estado Comercial (lead_management)
      db
        .select({
          commercialStatus: schema.leadManagement.commercialStatus,
          count: sql<number>`count(*)::int`,
        })
        .from(schema.leads)
        .leftJoin(schema.leadManagement, eq(schema.leads.id, schema.leadManagement.leadId))
        .where(period)
        .groupBy(schema.leadManagement.commercialStatus)
        .orderBy(desc(sql`count(*)`)),

      // Línea de tiempo: leads por día en timezone CDMX
      // TO_CHAR returns a plain string so the Neon driver never auto-coerces it to Date
      db.execute(
        sql`
          SELECT 
            TO_CHAR(${schema.leads.createdAt} AT TIME ZONE ${BUSINESS_TIMEZONE}, 'YYYY-MM-DD') AS day,
            count(*)::int AS count
          FROM app.leads
          WHERE ${schema.leads.createdAt} >= ${from} 
            AND ${schema.leads.createdAt} < ${to}
          GROUP BY 1
          ORDER BY 1 ASC
        `
      ),
    ]);

    const totals = totalsResult[0];

    return NextResponse.json({
      period: { from: from.toISOString(), to: to.toISOString() },
      kpis: {
        total: totals?.total ?? 0,
        delivered: totals?.delivered ?? 0,
        failed: totals?.failed ?? 0,
        duplicate: totals?.duplicate ?? 0,
        deliveryRate: totals?.total
          ? Math.round((totals.delivered / totals.total) * 1000) / 10
          : 0,
      },
      byStatus: byStatusResult,
      byState: byStateResult,
      bySource: bySourceResult,
      byCampaign: byCampaignResult,
      byMedium: byMediumResult,
      byCommercialStatus: byCommercialStatusResult,
      timeline: timelineResult.rows ?? timelineResult,
    });

  } catch (err) {
    logError('/api/admin/analytics/summary', 'handler', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
