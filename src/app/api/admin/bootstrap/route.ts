/**
 * POST /api/admin/bootstrap
 *
 * Promueve al PRIMER administrador BAIT. NO crea identidad ni contraseñas:
 * sólo inserta la fila de autorización en app.admin_profiles.
 *
 * Prerrequisito (fuera de esta app): el usuario ADMIN_BOOTSTRAP_EMAIL ya existe
 * en Neon Auth (creado por el operador con `neon neon-auth user create`, sin
 * contraseña) y ha establecido sus credenciales vía el flujo oficial de Neon Auth
 * (request-password-reset). Luego inicia sesión y llama a este endpoint.
 *
 * Flujo:
 *   1. Exige sesión válida de Neon Auth.
 *   2. El email de la sesión debe coincidir EXACTO con ADMIN_BOOTSTRAP_EMAIL.
 *   3. No debe existir ningún Administrador activo (one-shot).
 *   4. Inserta app.admin_profiles { role: 'Administrador', is_active: true }.
 *   5. Audita.
 *
 * Nunca escribe en neon_auth. Nunca maneja contraseñas.
 * Tras crear el primer Administrador, el endpoint queda inoperativo (409).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb, schema } from '@/db/index';
import { auth } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { eq } from 'drizzle-orm';
import { logError, logInfo } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest): Promise<NextResponse> {
  try {
    const bootstrapEmail = process.env.ADMIN_BOOTSTRAP_EMAIL;
    if (!bootstrapEmail) {
      return NextResponse.json(
        { error: 'ADMIN_BOOTSTRAP_EMAIL no configurado' },
        { status: 503 },
      );
    }

    // 1. Sesión válida de Neon Auth
    const { data: session, error } = await auth.getSession();
    if (error || !session?.user?.id) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    // 2. El email autenticado debe coincidir con ADMIN_BOOTSTRAP_EMAIL
    if (
      session.user.email?.toLowerCase().trim() !==
      bootstrapEmail.toLowerCase().trim()
    ) {
      return NextResponse.json(
        { error: 'La cuenta autenticada no es la designada para bootstrap' },
        { status: 403 },
      );
    }

    const db = getDb();

    // 3. One-shot: no debe existir ningún Administrador activo
    const existingAdmins = await db
      .select({ id: schema.adminProfiles.id })
      .from(schema.adminProfiles)
      .where(eq(schema.adminProfiles.role, 'Administrador'))
      .limit(1);

    if (existingAdmins.length > 0) {
      return NextResponse.json(
        { error: 'Sistema ya inicializado. Bootstrap deshabilitado.' },
        { status: 409 },
      );
    }

    // ¿Ya tiene perfil (inactivo / otro rol)? Entonces promoverlo, no duplicar.
    const [existingProfile] = await db
      .select()
      .from(schema.adminProfiles)
      .where(eq(schema.adminProfiles.authUserId, session.user.id))
      .limit(1);

    let profileId: string;
    if (existingProfile) {
      await db
        .update(schema.adminProfiles)
        .set({ role: 'Administrador', isActive: true, updatedAt: new Date() })
        .where(eq(schema.adminProfiles.id, existingProfile.id));
      profileId = existingProfile.id;
    } else {
      const [profile] = await db
        .insert(schema.adminProfiles)
        .values({
          authUserId: session.user.id,
          role: 'Administrador',
          isActive: true,
        })
        .returning({ id: schema.adminProfiles.id });
      profileId = profile.id;
    }

    await writeAuditLog({
      session: {
        userId: session.user.id,
        email: session.user.email,
        name: session.user.name,
        role: 'Administrador',
        profileId,
      },
      action: 'ADMIN_USER_INVITED',
      targetType: 'admin_user',
      targetId: profileId,
      safeMetadata: { bootstrap: true, role: 'Administrador' },
    });

    logInfo('/api/admin/bootstrap', 'created', { profileId });

    return NextResponse.json(
      { ok: true, message: 'Administrador inicial creado correctamente.', profileId },
      { status: 201 },
    );
  } catch (err) {
    logError('/api/admin/bootstrap', 'handler', err);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
