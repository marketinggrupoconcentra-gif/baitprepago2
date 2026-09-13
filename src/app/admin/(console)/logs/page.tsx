/**
 * src/app/admin/(console)/logs/page.tsx — Logs de entrega a Intelix
 *
 * Diseño: "Logs.dc.html" (Claude Design), replicado a exactitud.
 * Datos reales de app.delivery_outbox ⨝ app.leads ⨝ app.lead_attribution
 * vía /api/admin/logs. Requiere: logs.view
 */
import { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireAdminSessionOrRedirect } from '@/lib/session';
import { hasPermission } from '@/lib/rbac';
import LogsClient from '@/components/admin/LogsClient';

export const metadata: Metadata = { title: 'Logs' };

export default async function LogsPage() {
  const session = await requireAdminSessionOrRedirect();
  if (!hasPermission(session.role, 'logs.view')) redirect('/admin/dashboard');

  return (
    <LogsClient
      canRetry={hasPermission(session.role, 'logs.retry')}
      canViewPii={hasPermission(session.role, 'leads.detail.view')}
      canExportSensitive={hasPermission(session.role, 'leads.export.sensitive')}
    />
  );
}
