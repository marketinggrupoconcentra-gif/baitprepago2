/**
 * GET /api/admin/logs/export — Export CSV de las entregas a Intelix (delivery_outbox)
 *
 * Requiere: logs.view  (con ?sensitive=1 → además leads.export.sensitive)
 * Auditado: LEADS_EXPORTED (metadata event=logs_export)
 *
 * SEC-003: cada celda pasa por toCSVRow() → neutraliza formula injection + RFC4180.
 * NIP y blind indexes NUNCA se exportan. La respuesta cruda del proveedor no existe.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb, schema } from '@/db/index';
import { requireAdminSession } from '@/lib/session';
import { blindIndex, decryptPII } from '@/lib/crypto';
import { writeAuditLog, writeRequiredAuditLog } from '@/lib/audit';
import { and, desc, eq, gte, or, sql } from 'drizzle-orm';
import { logError } from '@/lib/log';
import { toCSVRow } from '@/lib/security/csv';
import { checkRateLimit, RATE_LIMITS } from '@/lib/security/rate-limiter';
import { checkBot } from '@/lib/security/bot-id';
import { extractIp, hashIp } from '@/lib/security/ip-hash';
import { classifyOutboxError } from '@/lib/outbox/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DAY_MS = 24 * 60 * 60 * 1000;
const OUTBOX_STATES = ['delivered', 'pending', 'processing', 'failed', 'dead'] as const;

function startOfDayMx(d: Date): Date {
  const shifted = new Date(d.getTime() - 6 * 60 * 60 * 1000);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() + 6 * 60 * 60 * 1000);
}
function rangeStart(range: string, now: Date): Date | null {
  if (range === 'hoy') return startOfDayMx(now);
  if (range === '7d') return new Date(startOfDayMx(now).getTime() - 6 * DAY_MS);
  if (range === '30d') return new Date(startOfDayMx(now).getTime() - 29 * DAY_MS);
  return null;
}
const iso = (d: Date | string | null) => (d ? (typeof d === 'string' ? d : d.toISOString()) : '');

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = req.nextUrl;
  const includeSensitive = url.searchParams.get('sensitive') === '1';
  const permission = includeSensitive ? 'leads.export.sensitive' : 'logs.view';

  let session;
  try {
    session = await requireAdminSession(permission);
  } catch (res) {
    return res as NextResponse;
  }

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
    const now = new Date();

    const conds = [eq(schema.deliveryOutbox.destination, 'intelix')];
    const from = rangeStart(url.searchParams.get('range') ?? 'all', now);
    if (from) conds.push(gte(schema.deliveryOutbox.createdAt, from));

    const tab = url.searchParams.get('tab');
    if (tab && (OUTBOX_STATES as readonly string[]).includes(tab)) {
      conds.push(eq(schema.deliveryOutbox.status, tab as (typeof OUTBOX_STATES)[number]));
    }
    const err = (url.searchParams.get('err') ?? '').trim();
    if (err && err !== 'all') conds.push(eq(schema.deliveryOutbox.lastErrorCode, err));

    const q = (url.searchParams.get('q') ?? '').trim();
    if (q) {
      const digits = q.replace(/\D/g, '');
      const like = q.toLowerCase().replace(/[%_]/g, '') + '%';
      const parts = [sql`${schema.leads.publicReference}::text ILIKE ${like}`];
      if (digits.length >= 10) parts.push(eq(schema.leads.phoneBidx, blindIndex(digits.slice(-10))));
      conds.push(or(...parts)!);
    }

    const rows = await db
      .select({
        id: schema.deliveryOutbox.id,
        status: schema.deliveryOutbox.status,
        attempts: schema.deliveryOutbox.attempts,
        nextAttemptAt: schema.deliveryOutbox.nextAttemptAt,
        deliveredAt: schema.deliveryOutbox.deliveredAt,
        lastErrorCode: schema.deliveryOutbox.lastErrorCode,
        createdAt: schema.deliveryOutbox.createdAt,
        updatedAt: schema.deliveryOutbox.updatedAt,
        folio: schema.leads.publicReference,
        leadStatus: schema.leads.status,
        stateCode: schema.leads.stateCode,
        firstNameEnc: schema.leads.firstNameEnc,
        lastNameEnc: schema.leads.lastNameEnc,
        phoneEnc: schema.leads.phoneEnc,
        emailEnc: schema.leads.emailEnc,
        sourceCategory: schema.leadAttribution.sourceCategory,
      })
      .from(schema.deliveryOutbox)
      .innerJoin(schema.leads, eq(schema.deliveryOutbox.leadId, schema.leads.id))
      .leftJoin(schema.leadAttribution, eq(schema.leads.id, schema.leadAttribution.leadId))
      .where(and(...conds))
      .orderBy(desc(schema.deliveryOutbox.createdAt))
      .limit(10000);

    const headers = includeSensitive
      ? ['outbox_id', 'folio', 'outbox_status', 'lead_status', 'attempts', 'last_error_code', 'error_label',
         'state_code', 'source_category', 'phone', 'nombre', 'correo',
         'created_at', 'updated_at', 'delivered_at', 'next_attempt_at']
      : ['outbox_id', 'folio', 'outbox_status', 'lead_status', 'attempts', 'last_error_code', 'error_label',
         'state_code', 'source_category',
         'created_at', 'updated_at', 'delivered_at', 'next_attempt_at'];

    const out = [toCSVRow(headers)];

    for (const r of rows) {
      const errLabel = r.lastErrorCode ? classifyOutboxError(r.lastErrorCode).label : '';
      let phone = '', nombre = '', correo = '';
      if (includeSensitive) {
        try {
          phone = decryptPII(r.phoneEnc);
          nombre = `${decryptPII(r.firstNameEnc)} ${decryptPII(r.lastNameEnc)}`.trim();
          correo = decryptPII(r.emailEnc);
        } catch {
          phone = nombre = correo = '[ERROR]';
        }
      }
      const common = [
        r.id, r.folio, r.status, r.leadStatus, r.attempts, r.lastErrorCode ?? '', errLabel,
        r.stateCode ?? '', r.sourceCategory ?? '',
      ];
      const tail = [iso(r.createdAt), iso(r.updatedAt), iso(r.deliveredAt), iso(r.nextAttemptAt)];
      out.push(toCSVRow(includeSensitive ? [...common, phone, nombre, correo, ...tail] : [...common, ...tail]));
    }

    const csv = '﻿' + out.join('\n');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `logs-crm-${stamp}.csv`;

    const auditFn = includeSensitive ? writeRequiredAuditLog : writeAuditLog;
    await auditFn({
      session,
      action: 'LEADS_EXPORTED',
      safeMetadata: { event: 'logs_export', count: rows.length, includeSensitive },
    });

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    logError('/api/admin/logs/export', 'GET', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
