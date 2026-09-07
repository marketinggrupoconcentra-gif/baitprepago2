const { requireAdminAuth } = require('../../lib/admin-auth');
const { neon } = require('@neondatabase/serverless');

module.exports = async function handler(req, res) {
  const admin = await requireAdminAuth(req, res, { roles: ['SUPER_ADMIN', 'ADMIN'] });
  if (!admin) return;

  const sql = neon(process.env.DATABASE_URL);

  if (req.method === 'GET') {
    const schedules = await sql`
      SELECT id, name, frequency, status, next_run_at 
      FROM report_schedules 
      ORDER BY created_at DESC
    `;
    return res.status(200).json({ schedules });
  }

  if (req.method === 'POST') {
    const { name, frequency, status } = req.body;
    
    if (!name || !frequency) {
      return res.status(400).json({ error: 'Faltan campos requeridos' });
    }

    const nextRun = frequency === 'DAILY' ? "NOW() + INTERVAL '1 day'" : 
                    frequency === 'WEEKLY' ? "NOW() + INTERVAL '7 days'" : "NOW() + INTERVAL '1 month'";

    // We will hardcode recipient to the user who creates it for now, 
    // or select all admins. Let's just send it to the creator.
    const recipientIds = JSON.stringify([admin.id]);

    await sql`
      INSERT INTO report_schedules (name, frequency, recipient_ids, status, next_run_at)
      VALUES (
        ${name}, 
        ${frequency}, 
        ${recipientIds}::jsonb, 
        ${status || 'PAUSED'}, 
        CASE 
            WHEN ${frequency} = 'DAILY' THEN NOW() + INTERVAL '1 day'
            WHEN ${frequency} = 'WEEKLY' THEN NOW() + INTERVAL '7 days'
            WHEN ${frequency} = 'MONTHLY' THEN NOW() + INTERVAL '1 month'
        END
      )
    `;

    return res.status(201).json({ success: true, message: 'Reporte programado creado' });
  }

  if (req.method === 'PATCH') {
    const { id, status } = req.body;
    if (!id || !status) return res.status(400).json({ error: 'ID y estado requeridos' });

    await sql`
      UPDATE report_schedules 
      SET status = ${status}, updated_at = NOW()
      WHERE id = ${id}
    `;
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Método no permitido' });
};
