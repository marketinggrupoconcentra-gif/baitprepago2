/**
 * GET /api/admin/leads/assignable-users — Lista de usuarios a los que se les puede asignar un lead.
 *
 * Requiere: leads.status.change permission
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb, schema } from '@/db/index';
import { requireAdminSession } from '@/lib/session';
import { auth } from '@/lib/auth';
import { desc, eq } from 'drizzle-orm';
import { logError } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_: NextRequest): Promise<NextResponse> {
  try {
    await requireAdminSession('leads.status.change');
  } catch (res) {
    return res as NextResponse;
  }

  try {
    const db = getDb();

    // Solo usuarios activos
    const profiles = await db
      .select({
        authUserId: schema.adminProfiles.authUserId,
      })
      .from(schema.adminProfiles)
      .where(eq(schema.adminProfiles.isActive, true))
      .orderBy(desc(schema.adminProfiles.createdAt));

    if (profiles.length === 0) {
      return NextResponse.json({ data: [] });
    }

    // Cruzar con Neon Auth para nombre
    const { data: list } = await auth.admin.listUsers({ query: { limit: 500 } });
    const userMap = new Map(
      (list?.users ?? []).map((u) => [u.id, { name: u.name, email: u.email }]),
    );

    const result = profiles.map((p) => ({
      id: p.authUserId,
      name: userMap.get(p.authUserId)?.name ?? 'Usuario',
      email: userMap.get(p.authUserId)?.email ?? '—',
    }));

    return NextResponse.json({ data: result });
  } catch (err) {
    logError('/api/admin/leads/assignable-users', 'handler', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
