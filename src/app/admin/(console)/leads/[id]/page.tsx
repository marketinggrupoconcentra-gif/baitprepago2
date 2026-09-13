/**
 * src/app/admin/(console)/leads/[id]/page.tsx
 *
 * Página de detalle de un lead individual.
 * Muestra todos los datos del formulario, atribución, consentimientos,
 * gestión comercial.
 */
import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireAdminSessionOrRedirect } from '@/lib/session';
import LeadDetailClient from '@/components/admin/LeadDetailClient';

export const metadata: Metadata = { title: 'Detalle de Lead' };

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireAdminSessionOrRedirect();
  const { id } = await params;

  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRe.test(id)) notFound();

  return <LeadDetailClient id={id} session={session} />;
}
