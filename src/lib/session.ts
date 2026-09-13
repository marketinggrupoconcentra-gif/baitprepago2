/**
 * src/lib/session.ts
 *
 * Helpers de sesión SERVER-SIDE para el Admin Console.
 *
 * SEPARACIÓN DE RESPONSABILIDADES:
 *   - Neon Auth (managed)  -> IDENTIDAD + SESIÓN  (auth.getSession()).
 *   - app.admin_profiles   -> AUTORIZACIÓN BAIT   (is_active + rol BAIT).
 *   - src/lib/rbac.ts      -> matriz de permisos por rol.
 *
 * NUNCA usar en Client Components. Llamar sólo en Server Components / Route Handlers.
 */
import 'server-only';
import { auth } from '@/lib/auth';
import { getDb, schema } from '@/db/index';
import { eq } from 'drizzle-orm';
import { hasPermission, isValidAdminRole } from '@/lib/rbac';
import type { AdminRole, Permission } from '@/lib/rbac';

export type AdminSession = {
  userId: string;     // neon_auth.user.id (UUID)
  email: string;
  name: string;
  role: AdminRole;
  profileId: string;  // app.admin_profiles.id
};

/**
 * Obtiene la sesión del administrador actual.
 * Verifica en orden:
 *   1. Sesión válida en Neon Auth
 *   2. Existe fila en app.admin_profiles para ese auth_user_id
 *   3. is_active = true
 *   4. rol BAIT válido
 *
 * @returns AdminSession o null si no autenticado / no autorizado.
 */
export async function getAdminSession(): Promise<AdminSession | null> {
  try {
    const { data, error } = await auth.getSession();
    if (error || !data?.user?.id) return null;

    const db = getDb();
    const profile = await db
      .select()
      .from(schema.adminProfiles)
      .where(eq(schema.adminProfiles.authUserId, data.user.id))
      .limit(1);

    if (!profile[0]) return null;
    if (!profile[0].isActive) return null;
    if (!isValidAdminRole(profile[0].role)) return null;

    return {
      userId: data.user.id,
      email: data.user.email,
      name: data.user.name,
      role: profile[0].role,
      profileId: profile[0].id,
    };
  } catch {
    return null;
  }
}

/**
 * Requiere una sesión de admin con un permiso específico.
 * Lanza Response 401/403 si no cumple. Usar en Route Handlers.
 */
export async function requireAdminSession(
  permission?: Permission,
): Promise<AdminSession> {
  const session = await getAdminSession();

  if (!session) {
    throw new Response(JSON.stringify({ error: 'No autenticado' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (permission && !hasPermission(session.role, permission)) {
    throw new Response(JSON.stringify({ error: 'Sin permiso para esta acción' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return session;
}

/**
 * Requiere una sesión de admin. Para uso en Server Components.
 * Redirige a /admin/login si no autenticado/autorizado.
 */
export async function requireAdminSessionOrRedirect(): Promise<AdminSession> {
  const { redirect } = await import('next/navigation');
  const session = await getAdminSession();

  if (!session) {
    redirect('/admin/login');
    // redirect() throws — TS no lo modela como never
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return null as any;
  }

  return session;
}
