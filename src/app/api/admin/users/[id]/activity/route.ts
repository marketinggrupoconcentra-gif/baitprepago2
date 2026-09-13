/**
 * GET /api/admin/users/[id]/activity — Historial de actividad (bitácora) de un usuario
 *
 * Requiere: users.view  (para CSV además: audit.view)
 * `id` = app.admin_profiles.id  → se resuelve a auth_user_id para consultar
 * app.audit_logs.actor_id.
 *
 * `?format=csv` descarga el historial (celdas protegidas contra inyección de fórmulas).
 * `?page=N` (0-index), `?eventId=<uuid>` para un solo evento.
 * NUNCA se expone la IP real — solo el prefijo del HMAC (`ip_hash`).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb, schema } from '@/db/index';
import { requireAdminSession } from '@/lib/session';
import { auth } from '@/lib/auth';
import { hasPermission } from '@/lib/rbac';
import { toCSV } from '@/lib/security/csv';
import { and, desc, eq, sql } from 'drizzle-orm';
import { logError } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 8;

const ACTION_LABEL: Record<string, string> = {
  ADMIN_LOGIN_SUCCESS: 'Inició sesión en el panel',
  ADMIN_LOGIN_DENIED: 'Intento de acceso denegado',
  ADMIN_LOGOUT: 'Cerró sesión',
  ADMIN_ROLE_CHANGED: 'Cambió el rol de una persona',
  ADMIN_USER_INVITED: 'Invitó a una persona al panel',
  ADMIN_INVITE_RESENT: 'Reenvió una invitación',
  ADMIN_USER_DISABLED: 'Revocó el acceso de una persona',
  ADMIN_USER_ENABLED: 'Restauró el acceso de una persona',
  LEAD_DETAIL_VIEWED: 'Abrió el detalle de un lead',
  LEAD_STATUS_CHANGED: 'Cambió el estado comercial de un lead',
  LEADS_EXPORTED: 'Exportó leads a CSV',
  REPORT_CREATED: 'Creó un reporte programado',
  REPORT_UPDATED: 'Editó un reporte programado',
  REPORT_DISABLED: 'Desactivó un reporte programado',
  REPORT_MANUAL_RUN: 'Ejecutó un reporte manualmente',
  SETTINGS_CHANGED: 'Cambió la configuración del panel',
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  let session;
  try {
    session = await requireAdminSession('users.view');
  } catch (res) {
    return res as NextResponse;
  }

  const { id } = await params;
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRe.test(id)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 400 });
  }

  const url = req.nextUrl;
  const format = url.searchParams.get('format');
  const eventId = url.searchParams.get('eventId');
  const page = Math.max(0, parseInt(url.searchParams.get('page') ?? '0', 10) || 0);

  if (format === 'csv' && !hasPermission(session.role, 'audit.view')) {
    return NextResponse.json({ error: 'Requiere permiso de auditoría' }, { status: 403 });
  }

  try {
    const db = getDb();

    const [profile] = await db
      .select({ authUserId: schema.adminProfiles.authUserId, role: schema.adminProfiles.role })
      .from(schema.adminProfiles)
      .where(eq(schema.adminProfiles.id, id))
      .limit(1);

    if (!profile) {
      return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });
    }

    let name = 'Usuario';
    let email = '—';
    try {
      const { data } = await auth.admin.listUsers({ query: { limit: 500 } });
      const u = (data?.users ?? []).find((x) => x.id === profile.authUserId);
      if (u) { name = u.name || name; email = u.email || email; }
    } catch { /* Neon Auth opcional para el CSV */ }

    const where = eventId && uuidRe.test(eventId)
      ? and(eq(schema.auditLogs.actorId, profile.authUserId), eq(schema.auditLogs.id, eventId))
      : eq(schema.auditLogs.actorId, profile.authUserId);

    // CSV completo = sin paginar; CSV de una página = paginado
    const wantsAll = format === 'csv' && url.searchParams.get('page') === null && !eventId;

    let total = 0;
    let firstAt: string | null = null;
    let events: Array<{
      id: string; action: string; targetType: string | null; targetId: string | null;
      ipHash: string | null; createdAt: Date;
    }> = [];
    let auditAvailable = true;

    try {
      const [countRow] = await db
        .select({ count: sql<number>`count(*)::int`, first: sql<string | null>`min(${schema.auditLogs.createdAt})` })
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.actorId, profile.authUserId));
      total = countRow?.count ?? 0;
      firstAt = countRow?.first ? new Date(countRow.first).toISOString() : null;

      const q = db
        .select({
          id: schema.auditLogs.id,
          action: schema.auditLogs.action,
          targetType: schema.auditLogs.targetType,
          targetId: schema.auditLogs.targetId,
          ipHash: schema.auditLogs.ipHash,
          createdAt: schema.auditLogs.createdAt,
        })
        .from(schema.auditLogs)
        .where(where)
        .orderBy(desc(schema.auditLogs.createdAt));

      events = wantsAll
        ? await q.limit(5000)
        : await q.limit(PAGE_SIZE).offset(page * PAGE_SIZE);
    } catch (e) {
      auditAvailable = false;
      logError('/api/admin/users/[id]/activity', 'audit_unavailable', e);
    }

    const fmt = (d: Date | string | null) => (d ? new Date(d).toLocaleString('es-MX', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
      hour12: false, timeZone: 'America/Mexico_City',
    }) : '—');
    const ipShort = (h: string | null) => (h ? `hmac:${h.slice(0, 10)}` : 'sin registro');

    if (format === 'csv') {
      const header = ['usuario', 'correo', 'rol', 'fecha_hora_cdmx', 'evento', 'objetivo', 'ip_hmac'];
      const rows = events.map((e) => [
        name, email, profile.role, fmt(e.createdAt),
        ACTION_LABEL[e.action] ?? e.action,
        e.targetType ? `${e.targetType}${e.targetId ? `:${e.targetId.slice(0, 8)}` : ''}` : '',
        ipShort(e.ipHash),
      ]);
      const csv = '﻿' + toCSV([header, ...rows]);
      const slug = email.split('@')[0].replace(/[^a-z0-9._-]/gi, '') || 'usuario';
      const suffix = eventId ? `-evento` : url.searchParams.get('page') !== null ? `-p${page + 1}` : '';
      return new NextResponse(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="historial-${slug}${suffix}.csv"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    return NextResponse.json({
      user: { name, email, role: profile.role },
      auditAvailable,
      total,
      firstAt,
      page,
      pageSize: PAGE_SIZE,
      data: events.map((e) => ({
        id: e.id,
        action: e.action,
        label: ACTION_LABEL[e.action] ?? e.action,
        targetType: e.targetType,
        targetId: e.targetId,
        at: new Date(e.createdAt).toISOString(),
        ip: ipShort(e.ipHash),
      })),
    });
  } catch (err) {
    logError('/api/admin/users/[id]/activity', 'handler', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
