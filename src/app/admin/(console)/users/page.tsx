/**
 * src/app/admin/(console)/users/page.tsx
 */
import { Metadata } from 'next';
import { requireAdminSessionOrRedirect } from '@/lib/session';
import UsersClient from '@/components/admin/UsersClient';

export const metadata: Metadata = { title: 'Usuarios' };

export default async function UsersPage() {
  const session = await requireAdminSessionOrRedirect();
  return <UsersClient session={session} />;
}
