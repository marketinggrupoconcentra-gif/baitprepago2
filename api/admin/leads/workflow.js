import { requireAdminSession } from '../../../lib/admin-session.js';
import { STATUS_CATALOG, REASON_CATALOG } from '../../../lib/lead-workflow.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const user = await requireAdminSession(req, res);
    if (!user) return; // Response is already handled by requireAdminSession

    const canManageStatus = user.role === 'SUPER_ADMIN';

    const statuses = Object.entries(STATUS_CATALOG).map(([value, label]) => ({ value, label }));
    const reasons = Object.entries(REASON_CATALOG).map(([value, label]) => ({ value, label }));

    return res.status(200).json({
      statuses,
      reasons,
      canManageStatus
    });
  } catch (err) {
    console.error('WORKFLOW_API_FAILED');
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
