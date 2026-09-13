/**
 * GET /api/admin/logs — Entregas a Intelix (app.delivery_outbox)
 *
 * Alimenta `/admin/logs` (diseño "Logs.dc.html"). Requiere: logs.view
 *
 * Cada fila = un registro del outbox de entrega: estado, nº de intentos, el
 * código de error saneado (`last_error_code`) y, en `last_error_payload`, lo
 * que se envió a Intelix (PII enmascarada, ver src/lib/outbox/intelix-log.ts)
 * + la respuesta cruda del proveedor — nunca se guarda PII/NIP en claro
 * (política de privacidad Etapa 2.2).
 *
 * PII: el teléfono / nombre / correo del lead sólo se descifran si el rol tiene
 * `leads.detail.view`; en ese caso se audita un `LEAD_DETAIL_VIEWED` de lista.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb, schema } from '@/db/index';
import { requireAdminSession } from '@/lib/session';
import { blindIndex, decryptPII } from '@/lib/crypto';
import { and, asc, desc, eq, gte, inArray, or, sql } from 'drizzle-orm';
import { logError } from '@/lib/log';
import { hasPermission } from '@/lib/rbac';
import { writeAuditLog } from '@/lib/audit';
import { MAX_ATTEMPTS } from '@/lib/outbox/claim';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DAY_MS = 24 * 60 * 60 * 1000;
const OUTBOX_STATES = ['delivered', 'pending', 'processing', 'failed', 'dead'] as const;
type OutboxState = (typeof OUTBOX_STATES)[number];

const DEFAULT_PER_PAGE = 10;
const MAX_PER_PAGE = 25;

/** Inicio del día CDMX (UTC-6, sin DST). */
function startOfDayMx(d: Date): Date {
  const shifted = new Date(d.getTime() - 6 * 60 * 60 * 1000);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() + 6 * 60 * 60 * 1000);
}

function rangeStart(range: string, now: Date): Date | null {
  if (range === 'hoy') return startOfDayMx(now);
  if (range === '7d') return new Date(startOfDayMx(now).getTime() - 6 * DAY_MS);
  if (range === '30d') return new Date(startOfDayMx(now).getTime() - 29 * DAY_MS);
  return null; // 'all'
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  let session;
  try {
    session = await requireAdminSession('logs.view');
  } catch (res) {
    return res as NextResponse;
  }

  const canViewPii = hasPermission(session.role, 'leads.detail.view');
  const canRetry = hasPermission(session.role, 'logs.retry');

  try {
    const url = req.nextUrl;
    const now = new Date();

    const tabParam = url.searchParams.get('tab') ?? 'todos';
    const tab: 'todos' | OutboxState =
      (OUTBOX_STATES as readonly string[]).includes(tabParam) ? (tabParam as OutboxState) : 'todos';
    const rangeParam = url.searchParams.get('range') ?? '7d';
    const range = ['hoy', '7d', '30d', 'all'].includes(rangeParam) ? rangeParam : '7d';
    const errParam = (url.searchParams.get('err') ?? 'all').trim();
    const q = (url.searchParams.get('q') ?? '').trim();
    const sortK = url.searchParams.get('sort') === 'attempts' ? 'attempts' : 'fecha';
    const dir = url.searchParams.get('dir') === 'asc' ? 'asc' : 'desc';
    const page = Math.max(0, parseInt(url.searchParams.get('page') ?? '0', 10) || 0);
    const perPage = Math.min(
      MAX_PER_PAGE,
      Math.max(5, parseInt(url.searchParams.get('perPage') ?? String(DEFAULT_PER_PAGE), 10) || DEFAULT_PER_PAGE),
    );

    const db = getDb();

    // ── Condiciones ──────────────────────────────────────────────────────────
    const base = [eq(schema.deliveryOutbox.destination, 'intelix')];
    const from = rangeStart(range, now);
    if (from) base.push(gte(schema.deliveryOutbox.createdAt, from));

    // filtros que NO dependen de la pestaña de estado (para los contadores)
    const scoped = [...base];

    if (q) {
      const digits = q.replace(/\D/g, '');
      const refLike = q.toLowerCase().replace(/[%_]/g, '') + '%';
      const conds = [sql`${schema.leads.publicReference}::text ILIKE ${refLike}`];
      if (digits.length >= 10) conds.push(eq(schema.leads.phoneBidx, blindIndex(digits.slice(-10))));
      scoped.push(or(...conds)!);
    }

    if (errParam && errParam !== 'all') {
      scoped.push(eq(schema.deliveryOutbox.lastErrorCode, errParam));
    }

    const listConds = [...scoped];
    if (tab !== 'todos') listConds.push(eq(schema.deliveryOutbox.status, tab));

    const listWhere = and(...listConds);
    const scopedWhere = and(...scoped);
    const rangeWhere = and(...base);

    const selectCols = {
      id: schema.deliveryOutbox.id,
      leadId: schema.deliveryOutbox.leadId,
      status: schema.deliveryOutbox.status,
      attempts: schema.deliveryOutbox.attempts,
      nextAttemptAt: schema.deliveryOutbox.nextAttemptAt,
      deliveredAt: schema.deliveryOutbox.deliveredAt,
      lastErrorCode: schema.deliveryOutbox.lastErrorCode,
      lastErrorPayload: schema.deliveryOutbox.lastErrorPayload,
      createdAt: schema.deliveryOutbox.createdAt,
      updatedAt: schema.deliveryOutbox.updatedAt,
      leaseExpiresAt: schema.deliveryOutbox.leaseExpiresAt,
      folio: schema.leads.publicReference,
      leadStatus: schema.leads.status,
      stateCode: schema.leads.stateCode,
      leadCreatedAt: schema.leads.createdAt,
      sourceCategory: schema.leadAttribution.sourceCategory,
      ...(canViewPii
        ? {
            firstNameEnc: schema.leads.firstNameEnc,
            lastNameEnc: schema.leads.lastNameEnc,
            phoneEnc: schema.leads.phoneEnc,
            emailEnc: schema.leads.emailEnc,
          }
        : {}),
    };

    const orderCol =
      sortK === 'attempts' ? schema.deliveryOutbox.attempts : schema.deliveryOutbox.createdAt;
    const orderBy = dir === 'asc' ? asc(orderCol) : desc(orderCol);

    const baseQuery = () =>
      db
        .select(selectCols)
        .from(schema.deliveryOutbox)
        .innerJoin(schema.leads, eq(schema.deliveryOutbox.leadId, schema.leads.id))
        .leftJoin(schema.leadAttribution, eq(schema.leads.id, schema.leadAttribution.leadId));

    const [rows, countRows, statusCounts, errorCounts, aggRows] = await Promise.all([
      baseQuery().where(listWhere).orderBy(orderBy, asc(schema.deliveryOutbox.id)).limit(perPage).offset(page * perPage),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.deliveryOutbox)
        .innerJoin(schema.leads, eq(schema.deliveryOutbox.leadId, schema.leads.id))
        .leftJoin(schema.leadAttribution, eq(schema.leads.id, schema.leadAttribution.leadId))
        .where(listWhere),
      // contadores por estado — respetan búsqueda/error pero NO la pestaña
      db
        .select({ status: schema.deliveryOutbox.status, n: sql<number>`count(*)::int` })
        .from(schema.deliveryOutbox)
        .innerJoin(schema.leads, eq(schema.deliveryOutbox.leadId, schema.leads.id))
        .where(scopedWhere)
        .groupBy(schema.deliveryOutbox.status),
      // códigos de error presentes en el rango (para el desplegable)
      db
        .select({ code: schema.deliveryOutbox.lastErrorCode, n: sql<number>`count(*)::int` })
        .from(schema.deliveryOutbox)
        .innerJoin(schema.leads, eq(schema.deliveryOutbox.leadId, schema.leads.id))
        .where(and(rangeWhere, inArray(schema.deliveryOutbox.status, ['failed', 'dead'])))
        .groupBy(schema.deliveryOutbox.lastErrorCode),
      // agregados para las tarjetas (todo el rango, sin filtros de pestaña/error/q)
      db
        .select({
          total: sql<number>`count(*)::int`,
          attemptsSum: sql<number>`coalesce(sum(${schema.deliveryOutbox.attempts}),0)::int`,
        })
        .from(schema.deliveryOutbox)
        .where(rangeWhere),
    ]);

    const counts: Record<string, number> = { delivered: 0, pending: 0, processing: 0, failed: 0, dead: 0 };
    for (const c of statusCounts) counts[c.status] = c.n;
    const scopeTotal = Object.values(counts).reduce((a, b) => a + b, 0);

    const errorOptions = errorCounts
      .filter((e) => e.code)
      .map((e) => ({ code: e.code as string, n: e.n }))
      .sort((a, b) => b.n - a.n);

    // ── Descifrado opcional de PII ───────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = rows.map((r: any) => {
      let pii: { fullName: string; phone: string; email: string } | null = null;
      if (canViewPii && r.firstNameEnc) {
        try {
          pii = {
            fullName: `${decryptPII(r.firstNameEnc)} ${decryptPII(r.lastNameEnc)}`.trim(),
            phone: decryptPII(r.phoneEnc),
            email: decryptPII(r.emailEnc),
          };
        } catch {
          pii = { fullName: '[corrupto]', phone: '[corrupto]', email: '[corrupto]' };
        }
      }
      return {
        id: r.id,
        leadId: r.leadId,
        status: r.status,
        attempts: r.attempts,
        nextAttemptAt: r.nextAttemptAt,
        deliveredAt: r.deliveredAt,
        lastErrorCode: r.lastErrorCode,
        lastErrorPayload: r.lastErrorPayload,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        leaseExpiresAt: r.leaseExpiresAt,
        folio: r.folio,
        leadStatus: r.leadStatus,
        stateCode: r.stateCode,
        sourceCategory: r.sourceCategory,
        pii,
      };
    });

    if (canViewPii && data.some((d) => d.pii)) {
      writeAuditLog({
        session,
        action: 'LEAD_DETAIL_VIEWED',
        targetType: 'lead',
        safeMetadata: { event: 'logs_list_view', count: data.filter((d) => d.pii).length },
      }).catch((e) => logError('/api/admin/logs', 'bulk_audit_log', e));
    }

    return NextResponse.json({
      data,
      counts,
      scopeTotal,
      errorOptions,
      stats: {
        delivered: counts.delivered,
        queued: counts.pending + counts.processing,
        failed: counts.failed,
        dead: counts.dead,
        attemptsAvg: aggRows[0]?.total ? (aggRows[0].attemptsSum / aggRows[0].total) : 0,
        rangeTotal: aggRows[0]?.total ?? 0,
      },
      pagination: {
        page,
        perPage,
        total: countRows[0]?.n ?? 0,
        totalPages: Math.max(1, Math.ceil((countRows[0]?.n ?? 0) / perPage)),
      },
      meta: {
        maxAttempts: MAX_ATTEMPTS,
        canRetry,
        canViewPii,
        range,
        updatedAt: now.toISOString(),
      },
    });
  } catch (err) {
    logError('/api/admin/logs', 'handler', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
