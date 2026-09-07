const { neon } = require('@neondatabase/serverless');
const { enqueueEmail } = require('../../lib/email');
const { renderReportEmail } = require('../../lib/email-templates');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const sql = neon(process.env.DATABASE_URL);

  // 1. Find scheduled reports that need to run, using FOR UPDATE to prevent concurrent scheduler runs
  // Note: Since we are in connectionless serverless, FOR UPDATE SKIP LOCKED on schedules 
  // might just return the row and release lock. So we rely on a quick UPDATE status = 'PROCESSING'
  // using CTE or just stable idempotency keys during email enqueueing.
  const schedules = await sql`
    WITH locked_schedules AS (
      SELECT id FROM report_schedules 
      WHERE status = 'ACTIVE' AND next_run_at <= NOW()
      FOR UPDATE SKIP LOCKED
    )
    UPDATE report_schedules s
    SET status = 'PROCESSING', updated_at = NOW()
    FROM locked_schedules l
    WHERE s.id = l.id
    RETURNING s.*
  `;

  if (schedules.length === 0) {
    return res.status(200).json({ generated: 0, message: 'No reports scheduled' });
  }

  let generated = 0;

  for (const schedule of schedules) {
    try {
      // Calculate period based on frequency strictly in America/Mexico_City
      let periodStart, periodEnd;
      if (schedule.frequency === 'DAILY') {
        const row = await sql`SELECT (date_trunc('day', NOW() AT TIME ZONE 'America/Mexico_City') - INTERVAL '1 day') AT TIME ZONE 'America/Mexico_City' AS start_date,
                                     (date_trunc('day', NOW() AT TIME ZONE 'America/Mexico_City')) AT TIME ZONE 'America/Mexico_City' AS end_date`;
        periodStart = row[0].start_date;
        periodEnd = row[0].end_date;
      } else if (schedule.frequency === 'WEEKLY') {
        // Assuming week starts on Monday
        const row = await sql`SELECT (date_trunc('week', NOW() AT TIME ZONE 'America/Mexico_City') - INTERVAL '1 week') AT TIME ZONE 'America/Mexico_City' AS start_date,
                                     (date_trunc('week', NOW() AT TIME ZONE 'America/Mexico_City')) AT TIME ZONE 'America/Mexico_City' AS end_date`;
        periodStart = row[0].start_date;
        periodEnd = row[0].end_date;
      } else {
        const row = await sql`SELECT (date_trunc('month', NOW() AT TIME ZONE 'America/Mexico_City') - INTERVAL '1 month') AT TIME ZONE 'America/Mexico_City' AS start_date,
                                     (date_trunc('month', NOW() AT TIME ZONE 'America/Mexico_City')) AT TIME ZONE 'America/Mexico_City' AS end_date`;
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
      const paidRes = await sql`
        SELECT COUNT(*) as paid FROM leads
        WHERE created_at >= ${periodStart} AND created_at < ${periodEnd}
          AND (utm_source IS NOT NULL OR fbclid IS NOT NULL)
      `;
      
      const totalLeads = parseInt(totalRes[0].total, 10) || 0;
      const organicLeads = parseInt(organicRes[0].org, 10) || 0;
      const paidLeads = parseInt(paidRes[0].paid, 10) || 0;
      const unassignedLeads = totalLeads - organicLeads - paidLeads; // For safety/unknowns

      const data = { totalLeads, organicLeads, paidLeads, unassignedLeads };
      
      // Formatting purely for display with explicit TimeZone
      const mxDateOptions = { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' };
      const startStr = new Intl.DateTimeFormat('es-MX', mxDateOptions).format(new Date(periodStart));
      // Since end_date is exclusive (00:00:00 of the next day), we subtract 1 ms for visual display of the last included day
      const displayEnd = new Date(new Date(periodEnd).getTime() - 1);
      const endStr = new Intl.DateTimeFormat('es-MX', mxDateOptions).format(displayEnd);
      const periodString = `${startStr} al ${endStr} (CDMX)`;

      // Get recipients from admin_users
      const recipientIds = schedule.recipient_ids; 
      if (!Array.isArray(recipientIds) || recipientIds.length === 0) {
        throw new Error('No recipients configured');
      }

      const users = await sql`
        SELECT email FROM admin_users WHERE id = ANY(${recipientIds}) AND active = true
      `;

      const { html, text, subject, type } = renderReportEmail(data, periodString);

      // Stable period key based on start timestamp
      const periodKey = new Date(periodStart).toISOString();

      // Enqueue emails
      for (const user of users) {
        await enqueueEmail({
          recipient: user.email,
          subject: subject,
          html_body: html,
          text_body: text,
          template_type: type,
          idempotency_key: `rep_${schedule.id}_${periodKey}_${user.email}`
        });
      }

      // Log run & update schedule back to ACTIVE
      await sql`
        WITH inserted_run AS (
          INSERT INTO report_runs (report_schedule_id, period_start, period_end, status)
          VALUES (${schedule.id}, ${periodStart}, ${periodEnd}, 'GENERATED')
          RETURNING id
        )
        UPDATE report_schedules 
        SET next_run_at = CASE 
            WHEN frequency = 'DAILY' THEN (date_trunc('day', NOW() AT TIME ZONE 'America/Mexico_City') + INTERVAL '1 day') AT TIME ZONE 'America/Mexico_City'
            WHEN frequency = 'WEEKLY' THEN (date_trunc('week', NOW() AT TIME ZONE 'America/Mexico_City') + INTERVAL '1 week') AT TIME ZONE 'America/Mexico_City'
            WHEN frequency = 'MONTHLY' THEN (date_trunc('month', NOW() AT TIME ZONE 'America/Mexico_City') + INTERVAL '1 month') AT TIME ZONE 'America/Mexico_City'
            ELSE NOW() + INTERVAL '1 day'
          END,
          status = 'ACTIVE',
          updated_at = NOW()
        WHERE id = ${schedule.id}
      `;

      generated++;
    } catch (err) {
      console.error(`Failed to run schedule ${schedule.id}:`, err);
      // Reset status to ACTIVE if it failed, so it can be retried
      await sql`UPDATE report_schedules SET status = 'ACTIVE' WHERE id = ${schedule.id}`;
    }
  }

  return res.status(200).json({ generated });
};
