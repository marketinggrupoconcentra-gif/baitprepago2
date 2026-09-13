/**
 * PATCH /api/admin/users/[id] — Cambiar rol o desactivar un usuario admin
 *
 * Requiere: users.role.change O users.disable
 * Auditado: ADMIN_ROLE_CHANGED | ADMIN_USER_DISABLED | ADMIN_USER_ENABLED
 * 
 * REGLA: No se puede desactivar a sí mismo.
 * REGLA: No se puede ser el último Administrador activo.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb, schema, withTransaction } from '@/db/index';
import { requireAdminSession } from '@/lib/session';
import { writeAuditLog } from '@/lib/audit';
import { eq, and, ne, sql } from 'drizzle-orm';
import { isValidAdminRole } from '@/lib/rbac';
import type { AdminRole } from '@/lib/rbac';
import { logError } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;

  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRe.test(id)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 400 });
  }

  let body: { role?: AdminRole; isActive?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 });
  }

  // Determinar qué permiso se requiere
  const needsRoleChange = body.role !== undefined;
  const needsActiveChange = body.isActive !== undefined;

  if (!needsRoleChange && !needsActiveChange) {
    return NextResponse.json({ error: 'Nada que actualizar' }, { status: 400 });
  }

  let session;
  try {
    if (needsRoleChange && needsActiveChange) {
      // First require one permission, then check the other manually or just require the strictest 
      // Since requireAdminSession returns the session and throws if unauthorized:
      session = await requireAdminSession('users.role.change');
      // Enforce the second permission as well
      await requireAdminSession('users.disable');
    } else {
      session = await requireAdminSession(
        needsRoleChange ? 'users.role.change' : 'users.disable',
      );
    }
  } catch (res) {
    return res as NextResponse;
  }

  try {
    let oldRole: string | undefined;

    await withTransaction(async (tx) => {
      // Bloqueo pesimista de todos los administradores activos para evitar carrera de democión
      await tx
        .select({ id: schema.adminProfiles.id })
        .from(schema.adminProfiles)
        .where(and(eq(schema.adminProfiles.role, 'Administrador'), eq(schema.adminProfiles.isActive, true)))
        .for('update');

      const [target] = await tx
        .select()
        .from(schema.adminProfiles)
        .where(eq(schema.adminProfiles.id, id))
        .limit(1);

      if (!target) {
        throw new Error('NOT_FOUND');
      }

      oldRole = target.role;

      // No puede modificarse a sí mismo (para proteger integridad)
      if (target.authUserId === session.userId) {
        throw new Error('SELF_MODIFICATION');
      }

      // Proteger: no puede quedar sin Administradores activos
      if (
        (needsRoleChange && body.role !== 'Administrador' && target.role === 'Administrador') ||
        (needsActiveChange && !body.isActive && target.role === 'Administrador')
      ) {
        const [adminCount] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(schema.adminProfiles)
          .where(
            and(
              eq(schema.adminProfiles.role, 'Administrador'),
              eq(schema.adminProfiles.isActive, true),
              ne(schema.adminProfiles.id, id),
            ),
          );

        if (!adminCount?.count || adminCount.count < 1) {
          throw new Error('LAST_ADMIN');
        }
      }

      // Actualizar
      const updates: Partial<typeof schema.adminProfiles.$inferInsert> = {
        updatedAt: new Date(),
      };
      if (needsRoleChange && isValidAdminRole(body.role)) updates.role = body.role;
      if (needsActiveChange && typeof body.isActive === 'boolean') updates.isActive = body.isActive;

      await tx
        .update(schema.adminProfiles)
        .set(updates)
        .where(eq(schema.adminProfiles.id, id));
    });

    const action = needsRoleChange
      ? 'ADMIN_ROLE_CHANGED'
      : body.isActive
      ? 'ADMIN_USER_ENABLED'
      : 'ADMIN_USER_DISABLED';

    await writeAuditLog({
      session,
      action,
      targetType: 'admin_user',
      targetId: id,
      safeMetadata: {
        ...(needsRoleChange ? { from: oldRole, to: body.role } : {}),
        ...(needsActiveChange ? { isActive: body.isActive } : {}),
      },
    });

    return NextResponse.json({ ok: true });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '';
    if (msg === 'NOT_FOUND') return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });
    if (msg === 'SELF_MODIFICATION') return NextResponse.json({ error: 'No puedes modificar tu propio perfil' }, { status: 403 });
    if (msg === 'LAST_ADMIN') return NextResponse.json({ error: 'No puedes remover al único Administrador activo' }, { status: 409 });
    
    logError('/api/admin/users/[id]', 'handler', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
