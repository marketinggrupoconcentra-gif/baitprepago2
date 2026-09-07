const { neon } = require('@neondatabase/serverless');
const crypto = require('crypto');
const { sendEmailViaResend, decryptPayload } = require('../../lib/email');

// Maximum emails to process per cron invocation
const BATCH_SIZE = 50;
const MAX_INTENTS = 5;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify Vercel Cron Secret to prevent public abuse
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const sql = neon(process.env.DATABASE_URL);
  const leaseId = crypto.randomUUID();
  
  // 1. Lock a batch of pending emails.
  // Using FOR UPDATE SKIP LOCKED to allow concurrent workers.
  // We include 'PROCESSING' to recover leases that expired from dead workers.
  const batch = await sql`
    WITH locked_msgs AS (
      SELECT id
      FROM email_outbox
      WHERE status IN ('QUEUED', 'RETRY', 'PROCESSING')
        AND (lease_until IS NULL OR lease_until < NOW())
      ORDER BY created_at ASC
      LIMIT ${BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE email_outbox e
    SET 
      status = 'PROCESSING',
      lease_until = NOW() + INTERVAL '5 minutes',
      updated_at = NOW(),
      provider_id = ${leaseId} -- Temporary use to store lease ownership during processing
    FROM locked_msgs l
    WHERE e.id = l.id
    RETURNING e.id, e.recipient, e.subject, e.html_body, e.text_body, e.intent_count, e.idempotency_key
  `;

  if (batch.length === 0) {
    return res.status(200).json({ processed: 0, message: 'No messages to process' });
  }

  const results = {
    processed: batch.length,
    success: 0,
    failed: 0,
    blocked: 0
  };

  // 2. Process each email
  for (const msg of batch) {
    const newIntentCount = msg.intent_count + 1;
    
    // Decrypt the payload
    const plainHtml = decryptPayload(msg.html_body);
    const plainText = decryptPayload(msg.text_body);

    if (plainHtml === '[ENCRYPTED_PAYLOAD_DECRYPTION_FAILED]' || plainText === '[ENCRYPTED_PAYLOAD_DECRYPTION_FAILED]') {
      // Unrecoverable decryption error
      results.failed++;
      await sql`
        UPDATE email_outbox
        SET status = 'FAILED', intent_count = ${newIntentCount}, error_message = 'Decryption failed', lease_until = NULL, updated_at = NOW()
        WHERE id = ${msg.id} AND provider_id = ${leaseId}
      `;
      continue;
    }

    const sendResult = await sendEmailViaResend({
      to: msg.recipient,
      subject: msg.subject,
      html: plainHtml,
      text: plainText
    }, msg.idempotency_key);

    if (sendResult.blocked) {
      // Blocked by configuration (e.g. disabled mode, or recipient not allowed in test mode)
      results.blocked++;
      await sql`
        UPDATE email_outbox
        SET status = 'BLOCKED_CONFIGURATION', intent_count = ${newIntentCount}, error_message = ${sendResult.error}, lease_until = NULL, updated_at = NOW()
        WHERE id = ${msg.id} AND provider_id = ${leaseId}
      `;
    } else if (sendResult.error) {
      // Failed to send
      results.failed++;
      const isFatal = newIntentCount >= MAX_INTENTS;
      const errorMsg = typeof sendResult.error === 'object' ? JSON.stringify(sendResult.error) : String(sendResult.error);

      if (isFatal) {
        await sql`
          UPDATE email_outbox
          SET status = 'FAILED', intent_count = ${newIntentCount}, error_message = ${errorMsg}, lease_until = NULL, updated_at = NOW(), provider_id = NULL
          WHERE id = ${msg.id} AND provider_id = ${leaseId}
        `;
      } else {
        await sql`
          UPDATE email_outbox
          SET status = 'RETRY', intent_count = ${newIntentCount}, error_message = ${errorMsg}, lease_until = NOW() + INTERVAL '5 minutes', updated_at = NOW(), provider_id = NULL
          WHERE id = ${msg.id} AND provider_id = ${leaseId}
        `;
      }
    } else {
      // Success
      results.success++;
      await sql`
        UPDATE email_outbox
        SET status = 'SENT', intent_count = ${newIntentCount}, provider_id = ${sendResult.id}, error_message = NULL, lease_until = NULL, updated_at = NOW()
        WHERE id = ${msg.id} AND provider_id = ${leaseId}
      `;
    }
  }

  return res.status(200).json(results);
};
