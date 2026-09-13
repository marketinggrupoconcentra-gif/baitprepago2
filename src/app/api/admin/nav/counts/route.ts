/**
 * GET /api/admin/nav/counts — Contadores para las insignias del sidebar
 *
 * Requiere: sesión admin. Cada contador se devuelve sólo si el rol tiene el
 * permiso de la sección; si no, `null` (el sidebar no pinta la insignia).
 *
 *   leadsPending → app.leads en estado técnico received|processing ("en validación")
 *  */
import { NextResponse } from 'next/server';
import { getDb, schema } from '@/db/index';
import { requireAdminSession } from '@/lib/session';
import { inArray, sql } from 'drizzle-orm';
import { hasPermission } from '@/lib/rbac';
import { logError } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  let session;
  try {
    session = await requireAdminSession();
  } catch (res) {
    return res as NextResponse;
  }

  const wantLeads = hasPermission(session.role, 'leads.view');

  try {
    const db = getDb();

    const [leadsRow] = await Promise.all([
      wantLeads
        ? db
            .select({ n: sql<number>`count(*)::int` })
            .from(schema.leads)
            .where(inArray(schema.leads.status, ['received', 'processing']))
        : Promise.resolve([{ n: 0 }]),
    ]);

    return NextResponse.json({
      leadsPending: wantLeads ? (leadsRow[0]?.n ?? 0) : null,
    });
  } catch (err) {
    logError('/api/admin/nav/counts', 'handler', err);
    // No romper la navegación por un fallo de conteo.
    return NextResponse.json({ leadsPending: null });
  }
}
