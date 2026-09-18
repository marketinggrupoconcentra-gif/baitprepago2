/**
 * src/app/admin/(console)/marketing/page.tsx — Tablero de decisión de marketing
 *
 * Diseño: "Marketing.dc.html" + "Mapa de Leads por Estado.html" (Claude Design).
 * Datos reales vía /api/admin/marketing. Requiere: marketing.view
 */
import { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireAdminSessionOrRedirect } from '@/lib/session';
import { hasPermission } from '@/lib/rbac';
import MarketingClient from '@/components/admin/MarketingClient';

export const metadata: Metadata = { title: 'Marketing' };

export default async function MarketingPage() {
  const session = await requireAdminSessionOrRedirect();
  if (!hasPermission(session.role, 'marketing.view')) redirect('/admin/dashboard');
  return <MarketingClient />;
}
