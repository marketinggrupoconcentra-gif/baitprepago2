const { neon } = require('@neondatabase/serverless');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_MODE = process.env.EMAIL_MODE || 'disabled'; // 'disabled', 'test', 'live'
const DEFAULT_FROM = process.env.EMAIL_FROM || 'BAIT Prepago <no-reply@baitprepago.com>';

/**
 * Enqueues an email into the durable outbox table.
 * @param {Object} params
 * @param {string} params.recipient
 * @param {string} params.subject
 * @param {string} params.html_body
 * @param {string} [params.text_body]
 * @param {string} params.template_type
 * @param {string} [params.idempotency_key]
 * @returns {Promise<number>} ID of the queued message
 */
async function enqueueEmail(params) {
  const sql = neon(process.env.DATABASE_URL);
  
  const idempotencyKey = params.idempotency_key || `msg_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;

  const result = await sql`
    INSERT INTO email_outbox (
      idempotency_key, recipient, subject, html_body, text_body, template_type, status
    ) VALUES (
      ${idempotencyKey}, ${params.recipient}, ${params.subject}, ${params.html_body}, 
      ${params.text_body || null}, ${params.template_type}, 'QUEUED'
    )
    ON CONFLICT (idempotency_key) DO UPDATE SET updated_at = NOW()
    RETURNING id
  `;
  
  return result[0].id;
}

/**
 * Sends an email synchronously via Resend API (used by the outbox worker).
 * @param {Object} payload 
 * @returns {Promise<{id?: string, error?: any}>}
 */
async function sendEmailViaResend({ to, subject, html, text }) {
  if (EMAIL_MODE === 'disabled') {
    console.log(`[EMAIL DISABLED] Simulated sending to ${to} | Subject: ${subject}`);
    return { id: `sim_${Date.now()}` };
  }
  
  if (!RESEND_API_KEY) {
    return { error: 'RESEND_API_KEY no configurada' };
  }

  // In test mode, we might want to redirect all emails to a safe domain,
  // or Resend might handle it via a test API key. Here we just log if test, but still send.
  if (EMAIL_MODE === 'test') {
    console.log(`[EMAIL TEST MODE] Sending to ${to} via Resend...`);
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: DEFAULT_FROM,
        to,
        subject,
        html,
        text
      })
    });

    const data = await res.json();
    if (res.ok) {
      return { id: data.id };
    } else {
      return { error: data };
    }
  } catch (err) {
    return { error: err.message || 'Network error' };
  }
}

/**
 * Checks if the email subsystem is configured properly.
 */
function getEmailConfigStatus() {
  return {
    mode: EMAIL_MODE,
    hasApiKey: !!RESEND_API_KEY,
    fromAddress: DEFAULT_FROM
  };
}

module.exports = {
  enqueueEmail,
  sendEmailViaResend,
  getEmailConfigStatus
};
