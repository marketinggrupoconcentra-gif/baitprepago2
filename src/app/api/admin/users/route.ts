/**
 * GET  /api/admin/users — Lista de administradores BAIT
 * POST /api/admin/users — Alta de usuario administrador (sin contraseña)
 *
 * GET  requiere: users.view
 * POST requiere: users.invite (solo Administrador)
 * Auditado: ADMIN_USER_INVITED
 *
 * IDENTIDAD -> Neon Auth (auth.admin.*). El Administrador NUNCA elige, conoce,
 * transmite ni almacena la contraseña del nuevo usuario: se crea la cuenta en
 * Neon Auth SIN contraseña y el usuario establece sus credenciales por sí mismo
 * mediante el flujo oficial de Neon Auth (request-password-reset).
 * AUTORIZACIÓN BAIT -> app.admin_profiles (rol + is_active).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb, schema } from '@/db/index';
import { requireAdminSession } from '@/lib/session';
import { writeAuditLog } from '@/lib/audit';
import { auth } from '@/lib/auth';
import { desc, inArray, sql } from 'drizzle-orm';
import { isValidAdminRole } from '@/lib/rbac';
import type { AdminRole } from '@/lib/rbac';
import { logError } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_: NextRequest): Promise<NextResponse> {
  try {
    await requireAdminSession('users.view');
  } catch (res) {
    return res as NextResponse;
  }

  try {
    const db = getDb();

    const profiles = await db
      .select({
        id: schema.adminProfiles.id,
        authUserId: schema.adminProfiles.authUserId,
        role: schema.adminProfiles.role,
        isActive: schema.adminProfiles.isActive,
        createdAt: schema.adminProfiles.createdAt,
        updatedAt: schema.adminProfiles.updatedAt,
      })
      .from(schema.adminProfiles)
      .orderBy(desc(schema.adminProfiles.createdAt));

    // Cruzar con Neon Auth para nombre / email
    const { data: list } = await auth.admin.listUsers({ query: { limit: 500 } });
    const userMap = new Map(
      (list?.users ?? []).map((u) => [u.id, { name: u.name, email: u.email }]),
    );

    // Actividad por usuario (app.audit_logs.actor_id) — nº de eventos + último acceso.
    // El rol de runtime puede NO tener SELECT sobre audit_logs (tabla append-only):
    // si falla, la vista degrada a 0 eventos / sin último acceso.
    const actorIds = profiles.map((p) => p.authUserId);
    let actMap = new Map<string | null, { eventCount: number; lastAt: string | null }>();
    if (actorIds.length) {
      try {
        const activity = await db
          .select({
            actorId: schema.auditLogs.actorId,
            eventCount: sql<number>`count(*)::int`,
            lastAt: sql<string | null>`max(${schema.auditLogs.createdAt})`,
          })
          .from(schema.auditLogs)
          .where(inArray(schema.auditLogs.actorId, actorIds))
          .groupBy(schema.auditLogs.actorId);
        actMap = new Map(activity.map((a) => [a.actorId, { eventCount: a.eventCount, lastAt: a.lastAt }]));
      } catch (e) {
        logError('/api/admin/users', 'audit_activity_unavailable', e);
      }
    }

    const result = profiles.map((p) => {
      const a = actMap.get(p.authUserId);
      return {
        ...p,
        name: userMap.get(p.authUserId)?.name ?? 'Usuario',
        email: userMap.get(p.authUserId)?.email ?? '—',
        eventCount: a?.eventCount ?? 0,
        lastAccessAt: a?.lastAt ? new Date(a.lastAt).toISOString() : null,
      };
    });

    return NextResponse.json({ data: result });
  } catch (err) {
    logError('/api/admin/users', 'handler', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let session;
  try {
    session = await requireAdminSession('users.invite');
  } catch (res) {
    return res as NextResponse;
  }

  let body: { email?: string; name?: string; role?: AdminRole };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 });
  }

  const email = body.email?.toLowerCase().trim() ?? '';
  const name = body.name?.trim() ?? '';

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Email inválido' }, { status: 400 });
  }
  if (!isValidAdminRole(body.role)) {
    return NextResponse.json({ error: 'Rol inválido' }, { status: 400 });
  }
  if (name.length < 2) {
    return NextResponse.json({ error: 'Nombre requerido' }, { status: 400 });
  }

  try {
    // Alta en Neon Auth SIN contraseña. Rol técnico mínimo: sólo el Administrador
    // BAIT necesita rol `admin` en Neon Auth (para poder gestionar usuarios).
    const { data: created, error } = await auth.admin.createUser({
      email,
      name,
      role: body.role === 'Administrador' ? 'admin' : 'user',
    });

    if (error || !created?.user?.id) {
      const msg = error?.message ?? '';
      const status = /exist|taken|already/i.test(msg) ? 409 : 502;
      return NextResponse.json(
        { error: status === 409 ? 'El email ya está registrado.' : 'No se pudo crear el usuario en Neon Auth.' },
        { status },
      );
    }

    const db = getDb();
    const [profile] = await db
      .insert(schema.adminProfiles)
      .values({
        authUserId: created.user.id,
        role: body.role,
        isActive: true,
        createdByAuthUserId: session.userId,
      })
      .returning({ id: schema.adminProfiles.id });

    // El nuevo usuario define su propia contraseña vía Neon Auth.
    await auth.requestPasswordReset({
      email,
      redirectTo: '/admin/reset-password',
    }).catch((e) => {
      logError('/api/admin/users', 'handler', e);
    });

    await writeAuditLog({
      session,
      action: 'ADMIN_USER_INVITED',
      targetType: 'admin_user',
      targetId: profile.id,
      safeMetadata: { role: body.role },
    });

    return NextResponse.json(
      { ok: true, profileId: profile.id, authUserId: created.user.id },
      { status: 201 },
    );
  } catch (err) {
    logError('/api/admin/users', 'handler', err);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
