/**
 * src/app/admin/layout.tsx
 * Layout raíz del área admin — aplica a (auth) y (console) grupos.
 */
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: {
    template: '%s — BAIT Prepago Admin',
    default: 'BAIT Prepago Admin',
  },
  description: 'Panel de administración BAIT Prepago',
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
