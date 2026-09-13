/**
 * src/app/admin/(console)/leads/page.tsx
 *
 * Página de gestión de leads.
 * Tabla con filtros, búsqueda, y drawer de detalle.
 */
import { Metadata } from 'next';
import { requireAdminSessionOrRedirect } from '@/lib/session';
import LeadsClient from '@/components/admin/LeadsClient';

export const metadata: Metadata = { title: 'Leads' };

export default async function LeadsPage() {
  const session = await requireAdminSessionOrRedirect();
  return <LeadsClient session={session} />;
}
