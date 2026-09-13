/**
 * GET /api/admin/leads/export — Export CSV de leads
 *
 * Requiere: leads.export (o leads.export.sensitive con ?sensitive=1)
 * Auditado: LEADS_EXPORTED
 *
 * SEC-003: cada celda pasa por csvCell() → neutraliza formula injection y
 * SIEMPRE aplica escaping estructural RFC4180 (nunca early-return).
 * NIP y blind indexes NUNCA se exportan.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb, schema } from '@/db/index';
import { requireAdminSession } from '@/lib/session';
import { decryptPII } from '@/lib/crypto';
import { writeAuditLog, writeRequiredAuditLog } from '@/lib/audit';
import { desc, and, gte, lt, eq } from 'drizzle-orm';
import { logError } from '@/lib/log';
import { toCSVRow } from '@/lib/security/csv';
import { getBusinessDayBounds } from '@/lib/business-time';
import { checkRateLimit, RATE_LIMITS } from '@/lib/security/rate-limiter';
import { checkBot } from '@/lib/security/bot-id';
import { extractIp, hashIp } from '@/lib/security/ip-hash';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = req.nextUrl;
  const includeSensitive = url.searchParams.get('sensitive') === '1';

  const permission = includeSensitive ? 'leads.export.sensitive' : 'leads.export';
  let session;
  try {
    session = await requireAdminSession(permission);
  } catch (res) {
    return res as NextResponse;
  }

  // ── Anti-scraping: bot check + rate limit dedicado (fail-closed) ──────────
  // Una sesión filtrada NO debe poder exfiltrar toda la base a golpe de bucle.
  if (checkBot(req.headers).isBot) {
    return NextResponse.json({ error: 'Request no permitida.' }, { status: 403 });
  }
  const ipHash = hashIp(extractIp(req.headers));
  const rl = await checkRateLimit(`${session.userId}:${ipHash}`, RATE_LIMITS.exportCsv, 'closed');
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Demasiadas exportaciones en poco tiempo. Intenta más tarde.' },
      { status: 429, headers: { 'Retry-After': String(Math.max(1, rl.retryAfterSecs)) } },
    );
  }

  try {
    const db = getDb();

    const conditions = [];
    const dateFrom = url.searchParams.get('dateFrom');
    const dateTo = url.searchParams.get('dateTo');
    const status = url.searchParams.get('status');

    if (dateFrom) {
      const { start } = getBusinessDayBounds(dateFrom);
      if (!isNaN(start.getTime())) conditions.push(gte(schema.leads.createdAt, start));
    }
    if (dateTo) {
      const { endExclusive } = getBusinessDayBounds(dateTo);
      if (!isNaN(endExclusive.getTime())) conditions.push(lt(schema.leads.createdAt, endExclusive));
    }
    if (status && ['received', 'processing', 'delivered', 'failed', 'duplicate'].includes(status)) {
      conditions.push(eq(schema.leads.status, status as 'received' | 'processing' | 'delivered' | 'failed' | 'duplicate'));
    }

    const leads = await db
      .select()
      .from(schema.leads)
      .leftJoin(schema.leadManagement, eq(schema.leads.id, schema.leadManagement.leadId))
      .leftJoin(schema.leadAttribution, eq(schema.leads.id, schema.leadAttribution.leadId))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(schema.leads.createdAt))
      .limit(10000);

    const headers = includeSensitive
      ? ['public_reference', 'status', 'commercial_status', 'state_code', 'plan_code',
         'first_name', 'last_name', 'email', 'phone', 'birthdate',
         'source_category', 'utm_source', 'utm_campaign', 'created_at']
      : ['public_reference', 'status', 'commercial_status', 'state_code', 'plan_code',
         'source_category', 'utm_source', 'utm_campaign', 'created_at'];

    const rows = [toCSVRow(headers)];

    for (const { leads: lead, lead_management: mgmt, lead_attribution: attr } of leads) {
      let pii: Record<string, string> = {};
      if (includeSensitive) {
        try {
          pii = {
            first_name: decryptPII(lead.firstNameEnc),
            last_name: decryptPII(lead.lastNameEnc),
            email: decryptPII(lead.emailEnc),
            phone: decryptPII(lead.phoneEnc),
            birthdate: lead.birthdateEnc ? decryptPII(lead.birthdateEnc) : '',
          };
        } catch {
          pii = { first_name: '[ERROR]', last_name: '[ERROR]', email: '[ERROR]', phone: '[ERROR]', birthdate: '[ERROR]' };
        }
      }

      const row = includeSensitive
        ? [lead.publicReference, lead.status, mgmt?.commercialStatus ?? 'NEW', lead.stateCode ?? '', lead.planCode,
           pii.first_name, pii.last_name, pii.email, pii.phone, pii.birthdate,
           attr?.sourceCategory ?? '', attr?.lastUtmSource ?? '', attr?.lastUtmCampaign ?? '',
           lead.createdAt?.toISOString()]
        : [lead.publicReference, lead.status, mgmt?.commercialStatus ?? 'NEW', lead.stateCode ?? '', lead.planCode,
           attr?.sourceCategory ?? '', attr?.lastUtmSource ?? '', attr?.lastUtmCampaign ?? '',
           lead.createdAt?.toISOString()];

      rows.push(toCSVRow(row));
    }

    const csvData = '\uFEFF' + rows.join('\n');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `leads-baitprepago-${timestamp}.csv`;

    if (includeSensitive) {
      await writeRequiredAuditLog({
        session,
        action: 'LEADS_EXPORTED',
        safeMetadata: { count: leads.length, includeSensitive, dateFrom, dateTo },
      });
    } else {
      await writeAuditLog({
        session,
        action: 'LEADS_EXPORTED',
        safeMetadata: { count: leads.length, includeSensitive, dateFrom, dateTo },
      });
    }

    return new NextResponse(csvData, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    logError('/api/admin/leads/export', 'GET', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
