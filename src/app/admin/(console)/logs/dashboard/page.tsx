/**
 * src/app/admin/(console)/logs/dashboard/page.tsx — Dashboard de entregas a Intelix
 *
 * Diseño: "Métricas de Logs.dc.html" (Claude Design), replicado a exactitud.
 * Datos reales de app.delivery_outbox vía /api/admin/logs/metrics.
 * Requiere: logs.view
 */
import { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireAdminSessionOrRedirect } from '@/lib/session';
import { hasPermission } from '@/lib/rbac';
import LogsMetricsClient from '@/components/admin/LogsMetricsClient';

export const metadata: Metadata = { title: 'Dashboard de logs' };

export default async function LogsDashboardPage() {
  const session = await requireAdminSessionOrRedirect();
  if (!hasPermission(session.role, 'logs.view')) redirect('/admin/dashboard');
  return <LogsMetricsClient />;
}
