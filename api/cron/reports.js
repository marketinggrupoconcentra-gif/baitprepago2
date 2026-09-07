const { neon } = require('@neondatabase/serverless');
const { enqueueEmail } = require('../../lib/email');
const { renderReportEmail } = require('../../lib/email-templates');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const sql = neon(process.env.DATABASE_URL);

  // 1. Find scheduled reports that need to run
  const schedules = await sql`
    SELECT * FROM report_schedules 
    WHERE status = 'ACTIVE' 
      AND next_run_at <= NOW()
  `;

  if (schedules.length === 0) {
    return res.status(200).json({ generated: 0, message: 'No reports scheduled' });
  }

  let generated = 0;

  for (const schedule of schedules) {
    try {
      // Calculate period based on frequency
      // Let's assume daily for now, period is last 24 hours.
      // (Advanced frequency logic would adjust this)
      let periodStart, periodEnd;
      if (schedule.frequency === 'DAILY') {
        const row = await sql`SELECT (NOW() - INTERVAL '1 day') AS start_date, NOW() AS end_date`;
        periodStart = row[0].start_date;
        periodEnd = row[0].end_date;
      } else if (schedule.frequency === 'WEEKLY') {
        const row = await sql`SELECT (NOW() - INTERVAL '7 days') AS start_date, NOW() AS end_date`;
        periodStart = row[0].start_date;
        periodEnd = row[0].end_date;
      } else {
        const row = await sql`SELECT (NOW() - INTERVAL '1 month') AS start_date, NOW() AS end_date`;
        periodStart = row[0].start_date;
        periodEnd = row[0].end_date;
      }

      // Query metrics
      const totalRes = await sql`
        SELECT COUNT(*) as total FROM leads 
        WHERE created_at >= ${periodStart} AND created_at < ${periodEnd}
      `;
      const organicRes = await sql`
        SELECT COUNT(*) as org FROM leads 
        WHERE created_at >= ${periodStart} AND created_at < ${periodEnd}
          AND utm_source IS NULL AND fbclid IS NULL
      `;
      
      const totalLeads = parseInt(totalRes[0].total, 10) || 0;
      const organicLeads = parseInt(organicRes[0].org, 10) || 0;
      const paidLeads = totalLeads - organicLeads;

      const data = { totalLeads, organicLeads, paidLeads };
      const periodString = `${new Date(periodStart).toLocaleDateString('es-MX')} al ${new Date(periodEnd).toLocaleDateString('es-MX')}`;

      // Get recipients from admin_users
      const recipientIds = schedule.recipient_ids; // array of IDs
      if (!Array.isArray(recipientIds) || recipientIds.length === 0) {
        throw new Error('No recipients configured');
      }

      const users = await sql`
        SELECT email FROM admin_users WHERE id = ANY(${recipientIds}) AND active = true
      `;

      const { html, text, subject, type } = renderReportEmail(data, periodString);

      // Enqueue emails
      for (const user of users) {
        await enqueueEmail({
          recipient: user.email,
          subject: subject,
          html_body: html,
          text_body: text,
          template_type: type,
          idempotency_key: `rep_${schedule.id}_${Date.now()}_${user.email}`
        });
      }

      // Calculate next run
      let nextRunStr = "NOW() + INTERVAL '1 day'";
      if (schedule.frequency === 'WEEKLY') nextRunStr = "NOW() + INTERVAL '7 days'";
      if (schedule.frequency === 'MONTHLY') nextRunStr = "NOW() + INTERVAL '1 month'";

      // Log run & update schedule
      await sql`
        INSERT INTO report_runs (report_schedule_id, period_start, period_end, status)
        VALUES (${schedule.id}, ${periodStart}, ${periodEnd}, 'GENERATED')
      `;

      // Actually, sql cannot use nextRunStr directly in string interpolation like that safely if it's dynamic interval, 
      // but we can use case statement.
      await sql`
        UPDATE report_schedules 
        SET next_run_at = CASE 
            WHEN frequency = 'DAILY' THEN NOW() + INTERVAL '1 day'
            WHEN frequency = 'WEEKLY' THEN NOW() + INTERVAL '7 days'
            WHEN frequency = 'MONTHLY' THEN NOW() + INTERVAL '1 month'
          END,
          updated_at = NOW()
        WHERE id = ${schedule.id}
      `;

      generated++;
    } catch (err) {
      console.error(`Failed to run schedule ${schedule.id}:`, err);
    }
  }

  return res.status(200).json({ generated });
};
