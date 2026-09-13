/**
 * src/app/admin/(console)/dashboard/page.tsx
 *
 * Resumen (dashboard) del admin. Diseño: "Resumen.dc.html" (Claude Design).
 * Los datos los pide el cliente a /api/admin/dashboard/summary (permite el
 * selector de rango Hoy / 7d / 30d sin recargar la página).
 */
import { Metadata } from 'next';
import { requireAdminSessionOrRedirect } from '@/lib/session';
import DashboardClient from '@/components/admin/DashboardClient';

export const metadata: Metadata = { title: 'Resumen' };
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  await requireAdminSessionOrRedirect();
  return <DashboardClient />;
}
