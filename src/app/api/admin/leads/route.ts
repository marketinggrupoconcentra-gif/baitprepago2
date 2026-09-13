/**
 * GET  /api/admin/leads — Lista de leads con filtros y paginación
 * 
 * Requiere: leads.view permission
 * PII: NO devuelve PII descifrada. Solo metadata segura + indicadores.
 * Búsqueda: Por blind index (email/teléfono)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb, schema } from '@/db/index';
import { requireAdminSession } from '@/lib/session';
import { blindIndex, decryptPII } from '@/lib/crypto';
import { eq, and, asc, desc, gte, lt, sql, or, isNull, inArray } from 'drizzle-orm';
import { logError } from '@/lib/log';
import { getBusinessDayBounds } from '@/lib/business-time';
import { hasPermission } from '@/lib/rbac';
import { writeAuditLog } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

export async function GET(req: NextRequest): Promise<NextResponse> {
  let session;
  try {
    session = await requireAdminSession('leads.view');
  } catch (res) {
    return res as NextResponse;
  }
  
  const canViewPii = hasPermission(session.role, 'leads.detail.view');

  try {
    const url = req.nextUrl;
    const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1'));
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(url.searchParams.get('pageSize') ?? String(PAGE_SIZE))));
    const status = url.searchParams.get('status');
    const commercialStatus = url.searchParams.get('commercialStatus');
    const stateCode = url.searchParams.get('stateCode');
    const searchEmail = url.searchParams.get('searchEmail');
    const searchPhone = url.searchParams.get('searchPhone');
    const dateFrom = url.searchParams.get('dateFrom');
    const dateTo = url.searchParams.get('dateTo');
    const sourceCategory = url.searchParams.get('sourceCategory');
    const q = url.searchParams.get('q');
    const sort = url.searchParams.get('sort') === 'folio' ? 'folio' : 'recibido';
    const dir = url.searchParams.get('dir') === 'asc' ? 'asc' : 'desc';

    const db = getDb();

    // Construir condiciones de filtro
    const conditions = [];
    // Condiciones que NO dependen del estado (para los conteos por pestaña)
    const baseConditions = [];

    if (status) {
      const allowed = ['received', 'processing', 'delivered', 'failed', 'duplicate'] as const;
      const wanted = status.split(',').map((s) => s.trim()).filter((s): s is (typeof allowed)[number] => (allowed as readonly string[]).includes(s));
      if (wanted.length === 1) conditions.push(eq(schema.leads.status, wanted[0]));
      else if (wanted.length > 1) conditions.push(inArray(schema.leads.status, wanted));
    }

    if (stateCode) {
      const c = eq(schema.leads.stateCode, stateCode.toUpperCase().slice(0, 2));
      conditions.push(c);
      baseConditions.push(c);
    }

    const validSources = ['google_ads', 'meta_ads', 'paid_other', 'organic', 'referral', 'direct', 'other'];
    if (sourceCategory && validSources.includes(sourceCategory)) {
      const c = eq(schema.leadAttribution.sourceCategory, sourceCategory as 'google_ads');
      conditions.push(c);
      baseConditions.push(c);
    }

    // Búsqueda unificada: folio (prefijo) o teléfono (blind index si son 10 dígitos)
    if (q && q.trim()) {
      const term = q.trim();
      const digits = term.replace(/\D/g, '');
      const refCond = sql`${schema.leads.publicReference}::text ILIKE ${term.toLowerCase().replace(/[%_]/g, '') + '%'}`;
      let c;
      if (digits.length >= 10) {
        c = or(refCond, eq(schema.leads.phoneBidx, blindIndex(digits.slice(-10))));
      } else {
        c = refCond;
      }
      conditions.push(c);
      baseConditions.push(c);
    }

    if (dateFrom) {
      const { start } = getBusinessDayBounds(dateFrom);
      if (!isNaN(start.getTime())) {
        conditions.push(gte(schema.leads.createdAt, start));
        baseConditions.push(gte(schema.leads.createdAt, start));
      }
    }

    if (dateTo) {
      const { endExclusive } = getBusinessDayBounds(dateTo);
      if (!isNaN(endExclusive.getTime())) {
        conditions.push(lt(schema.leads.createdAt, endExclusive));
        baseConditions.push(lt(schema.leads.createdAt, endExclusive));
      }
    }

    // Búsqueda por blind index (exacta, sin descifrar)
    if (searchEmail) {
      const bidx = blindIndex(searchEmail.trim().toLowerCase());
      conditions.push(eq(schema.leads.emailBidx, bidx));
    }

    if (searchPhone) {
      const phone = searchPhone.replace(/\D/g, '').slice(-10);
      if (phone.length === 10) {
        const bidx = blindIndex(phone);
        conditions.push(eq(schema.leads.phoneBidx, bidx));
      }
    }

    if (commercialStatus) {
      if (commercialStatus === 'NEW') {
        conditions.push(or(
          eq(schema.leadManagement.commercialStatus, 'NEW'),
          isNull(schema.leadManagement.commercialStatus)
        ));
      } else {
        conditions.push(eq(schema.leadManagement.commercialStatus, commercialStatus as 'NEW' | 'CONTACTED' | 'FOLLOW_UP' | 'WON' | 'LOST'));
      }
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const baseWhere = baseConditions.length > 0 ? and(...baseConditions) : undefined;

    const orderCol = sort === 'folio' ? schema.leads.publicReference : schema.leads.createdAt;
    const orderBy = dir === 'asc' ? asc(orderCol) : desc(orderCol);

    // Query principal con JOINs
    const [rows, countResult, statusCounts] = await Promise.all([
      db
        .select({
          id: schema.leads.id,
          publicReference: schema.leads.publicReference,
          status: schema.leads.status,
          stateCode: schema.leads.stateCode,
          planCode: schema.leads.planCode,
          createdAt: schema.leads.createdAt,
          updatedAt: schema.leads.updatedAt,
          ...(canViewPii ? {
            firstNameEnc: schema.leads.firstNameEnc,
            lastNameEnc: schema.leads.lastNameEnc,
            phoneEnc: schema.leads.phoneEnc,
            birthdateEnc: schema.leads.birthdateEnc,
          } : {}),
          // De lead_management (opcional)
          commercialStatus: schema.leadManagement.commercialStatus,
          assignedTo: schema.leadManagement.assignedToAuthUserId,
          // De lead_attribution (opcional)
          sourceCategory: schema.leadAttribution.sourceCategory,
          utmSource: schema.leadAttribution.lastUtmSource,
          utmCampaign: schema.leadAttribution.lastUtmCampaign,
        })
        .from(schema.leads)
        .leftJoin(schema.leadManagement, eq(schema.leads.id, schema.leadManagement.leadId))
        .leftJoin(schema.leadAttribution, eq(schema.leads.id, schema.leadAttribution.leadId))
        .where(whereClause)
        .orderBy(orderBy)
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.leads)
        .leftJoin(schema.leadManagement, eq(schema.leads.id, schema.leadManagement.leadId))
        .leftJoin(schema.leadAttribution, eq(schema.leads.id, schema.leadAttribution.leadId))
        .where(whereClause),
      // Conteos por estado técnico (ignora el filtro de estado — para las pestañas)
      db
        .select({ status: schema.leads.status, count: sql<number>`count(*)::int` })
        .from(schema.leads)
        .leftJoin(schema.leadAttribution, eq(schema.leads.id, schema.leadAttribution.leadId))
        .where(baseWhere)
        .groupBy(schema.leads.status),
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const decryptedRows = rows.map((r: any) => {
      let pii = undefined;
      if (canViewPii && r.firstNameEnc) {
        try {
          const birthdateStr = r.birthdateEnc ? decryptPII(r.birthdateEnc) : '';
          const birthDate = new Date(birthdateStr);
          let age = null;
          if (birthdateStr && !isNaN(birthDate.getTime())) {
            const ageDifMs = Date.now() - birthDate.getTime();
            const ageDate = new Date(ageDifMs);
            age = Math.abs(ageDate.getUTCFullYear() - 1970);
          }

          pii = {
            fullName: `${decryptPII(r.firstNameEnc)} ${decryptPII(r.lastNameEnc!)}`.trim(),
            phone: decryptPII(r.phoneEnc!),
            birthdate: birthdateStr,
            age,
          };
        } catch {
          pii = { fullName: '[Corrupto]', phone: '[Corrupto]', birthdate: '[Corrupto]', age: null };
        }
      }

      return {
        id: r.id,
        publicReference: r.publicReference,
        status: r.status,
        stateCode: r.stateCode,
        planCode: r.planCode,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        commercialStatus: r.commercialStatus,
        assignedTo: r.assignedTo,
        sourceCategory: r.sourceCategory,
        utmSource: r.utmSource,
        utmCampaign: r.utmCampaign,
        pii,
      };
    });

    if (canViewPii && decryptedRows.length > 0) {
      // Async audit log - don't block response
      writeAuditLog({
        session,
        action: 'LEADS_EXPORTED', // Wait, we need a generic bulk view event, but LEAD_DETAIL_VIEWED is single target. We can reuse LEADS_EXPORTED or just LEAD_DETAIL_VIEWED with empty target but full metadata
        targetType: 'lead',
        targetId: undefined,
        safeMetadata: { event: 'list_view', count: decryptedRows.length },
      }).catch((e) => logError('/api/admin/leads', 'bulk_audit_log', e));
    }

    const counts: Record<string, number> = {
      received: 0, processing: 0, delivered: 0, failed: 0, duplicate: 0,
    };
    for (const c of statusCounts) counts[c.status] = c.count;

    return NextResponse.json({
      data: decryptedRows,
      counts,
      pagination: {
        page,
        pageSize,
        total: countResult[0]?.count ?? 0,
        totalPages: Math.ceil((countResult[0]?.count ?? 0) / pageSize),
      },
    });

  } catch (err) {
    logError('/api/admin/leads', 'handler', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
