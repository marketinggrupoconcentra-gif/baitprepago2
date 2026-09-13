/**
 * src/app/admin/page.tsx — Redirige /admin → /admin/dashboard
 */
import { redirect } from 'next/navigation';
export default function AdminRootPage() {
  redirect('/admin/dashboard');
}
