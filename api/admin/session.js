import { requireAdminSession } from '../../lib/admin-session.js';

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Delegate all session validation to the centralized guard
  const user = await requireAdminSession(req, res);
  if (!user) return; // 401 already sent by guard

  return res.status(200).json({
    authenticated: true,
    user: {
      email: user.email,
      role: user.role
    }
  });
}
