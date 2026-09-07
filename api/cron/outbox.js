const { neon } = require('@neondatabase/serverless');
const { sendEmailViaResend } = require('../../lib/email');

// Maximum emails to process per cron invocation
const BATCH_SIZE = 50;
const MAX_INTENTS = 5;

module.exports = async function handler(req, res) {
  // Verify Vercel Cron Secret to prevent public abuse
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const sql = neon(process.env.DATABASE_URL);
  
  // 1. Lock a batch of pending emails.
  // Using FOR UPDATE SKIP LOCKED to allow concurrent workers if needed.
  // We lock rows in QUEUED or RETRY status where lease_until is null or past.
  const batch = await sql`
    WITH locked_msgs AS (
      SELECT id
      FROM email_outbox
      WHERE status IN ('QUEUED', 'RETRY')
        AND (lease_until IS NULL OR lease_until < NOW())
      ORDER BY created_at ASC
      LIMIT ${BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE email_outbox e
    SET 
      status = 'PROCESSING',
      lease_until = NOW() + INTERVAL '5 minutes',
      updated_at = NOW()
    FROM locked_msgs l
    WHERE e.id = l.id
    RETURNING e.id, e.recipient, e.subject, e.html_body, e.text_body, e.intent_count
  `;

  if (batch.length === 0) {
    return res.status(200).json({ processed: 0, message: 'No messages to process' });
  }

  const results = {
    processed: batch.length,
    success: 0,
    failed: 0
  };

  // 2. Process each email
  for (const msg of batch) {
    const newIntentCount = msg.intent_count + 1;
    const sendResult = await sendEmailViaResend({
      to: msg.recipient,
      subject: msg.subject,
      html: msg.html_body,
      text: msg.text_body
    });

    if (sendResult.error) {
      // Failed to send
      results.failed++;
      const isFatal = newIntentCount >= MAX_INTENTS;
      const nextStatus = isFatal ? 'FAILED' : 'RETRY';
      // simple backoff for lease (e.g. 5 minutes * intent_count)
      const nextLease = isFatal ? null : `NOW() + INTERVAL '${5 * newIntentCount} minutes'`;
      
      const errorMsg = typeof sendResult.error === 'object' ? JSON.stringify(sendResult.error) : sendResult.error;

      if (isFatal) {
        await sql`
          UPDATE email_outbox
          SET status = 'FAILED', intent_count = ${newIntentCount}, error_message = ${errorMsg}, lease_until = NULL, updated_at = NOW()
          WHERE id = ${msg.id}
        `;
      } else {
        await sql`
          UPDATE email_outbox
          SET status = 'RETRY', intent_count = ${newIntentCount}, error_message = ${errorMsg}, lease_until = NOW() + INTERVAL '5 minutes', updated_at = NOW()
          WHERE id = ${msg.id}
        `;
      }
    } else {
      // Success
      results.success++;
      await sql`
        UPDATE email_outbox
        SET status = 'SENT', intent_count = ${newIntentCount}, provider_id = ${sendResult.id}, error_message = NULL, lease_until = NULL, updated_at = NOW()
        WHERE id = ${msg.id}
      `;
    }
  }

  return res.status(200).json(results);
};
