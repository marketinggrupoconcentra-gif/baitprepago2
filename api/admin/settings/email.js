const { requireAdminAuth } = require('../../lib/admin-auth');
const { getEmailConfigStatus } = require('../../lib/email');
const { neon } = require('@neondatabase/serverless');

module.exports = async function handler(req, res) {
  const admin = await requireAdminAuth(req, res, { roles: ['SUPER_ADMIN', 'ADMIN'] });
  if (!admin) return;

  if (req.method === 'GET') {
    const status = getEmailConfigStatus();
    
    // Get outbox metrics
    const sql = neon(process.env.DATABASE_URL);
    const metrics = await sql`
      SELECT status, COUNT(*) as count 
      FROM email_outbox 
      GROUP BY status
    `;

    const outboxStats = {
      QUEUED: 0,
      PROCESSING: 0,
      SENT: 0,
      FAILED: 0,
      RETRY: 0
    };

    metrics.forEach(m => {
      if (outboxStats[m.status] !== undefined) {
        outboxStats[m.status] = parseInt(m.count, 10);
      }
    });

    return res.status(200).json({ config: status, outbox: outboxStats });
  }

  return res.status(405).json({ error: 'Método no permitido' });
};
