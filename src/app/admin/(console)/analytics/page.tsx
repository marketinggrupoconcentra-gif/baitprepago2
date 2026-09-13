/**
 * src/app/admin/(console)/analytics/page.tsx
 */
import { Metadata } from 'next';
import { requireAdminSessionOrRedirect } from '@/lib/session';
import AnalyticsClient from '@/components/admin/AnalyticsClient';

export const metadata: Metadata = { title: 'Analítica' };

export default async function AnalyticsPage() {
  await requireAdminSessionOrRedirect();
  return <AnalyticsClient />;
}
