const { neon } = require('@neondatabase/serverless');
const crypto = require('crypto');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_MODE = process.env.EMAIL_MODE || 'disabled'; // 'disabled', 'test', 'live'
const DEFAULT_FROM = process.env.EMAIL_FROM;
const TEST_ALLOWED_DOMAINS = (process.env.TEST_ALLOWED_DOMAINS || '').split(',').map(d => d.trim().toLowerCase()).filter(Boolean);

// We need a separate secret for payload encryption to avoid token leakage
const PAYLOAD_SECRET = process.env.EMAIL_PAYLOAD_SECRET;
const ALGORITHM = 'aes-256-gcm';

function encryptPayload(text) {
  if (!text) return null;
  if (!PAYLOAD_SECRET || PAYLOAD_SECRET.length !== 32) {
    throw new Error('EMAIL_PAYLOAD_SECRET missing or invalid length (must be 32 bytes)');
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(PAYLOAD_SECRET, 'utf8'), iv);
  let encrypted = cipher.update(text, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const authTag = cipher.getAuthTag().toString('base64');
  return JSON.stringify({ iv: iv.toString('base64'), authTag, data: encrypted });
}

function decryptPayload(encryptedJson) {
  if (!encryptedJson) return null;
  if (!PAYLOAD_SECRET || PAYLOAD_SECRET.length !== 32) {
    throw new Error('EMAIL_PAYLOAD_SECRET missing or invalid length');
  }
  try {
    const { iv, authTag, data } = JSON.parse(encryptedJson);
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      Buffer.from(PAYLOAD_SECRET, 'utf8'),
      Buffer.from(iv, 'base64')
    );
    decipher.setAuthTag(Buffer.from(authTag, 'base64'));
    let decrypted = decipher.update(data, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (e) {
    console.error('Failed to decrypt email payload:', e.message);
    return '[ENCRYPTED_PAYLOAD_DECRYPTION_FAILED]';
  }
}

/**
 * Enqueues an email into the durable outbox table.
 * @param {Object} params
 * @param {string} params.recipient
 * @param {string} params.subject
 * @param {string} params.html_body
 * @param {string} [params.text_body]
 * @param {string} params.template_type
 * @param {string} [params.idempotency_key]
 * @param {any} [tx] Optional database transaction object
 * @returns {Promise<number>} ID of the queued message
 */
async function enqueueEmail(params, tx) {
  const sql = tx || neon(process.env.DATABASE_URL);
  
  const idempotencyKey = params.idempotency_key || `msg_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;

  const encHtml = encryptPayload(params.html_body);
  const encText = encryptPayload(params.text_body);

  const result = await sql`
    INSERT INTO email_outbox (
      idempotency_key, recipient, subject, html_body, text_body, template_type, status
    ) VALUES (
      ${idempotencyKey}, ${params.recipient}, ${params.subject}, ${encHtml}, 
      ${encText}, ${params.template_type}, 'QUEUED'
    )
    ON CONFLICT (idempotency_key) DO UPDATE SET updated_at = NOW()
    RETURNING id
  `;
  
  return result[0].id;
}

/**
 * Sends an email synchronously via Resend API (used by the outbox worker).
 * @param {Object} payload 
 * @param {string} idempotencyKey
 * @returns {Promise<{id?: string, error?: any, blocked?: boolean}>}
 */
async function sendEmailViaResend({ to, subject, html, text }, idempotencyKey) {
  if (EMAIL_MODE === 'disabled') {
    console.log(`[EMAIL DISABLED] Blocked sending to ${to}`);
    // Return explicit blocked status so the worker can mark it as BLOCKED_CONFIGURATION
    // and we don't return a fake ID that makes it look like it was sent.
    return { blocked: true, error: 'EMAIL_MODE is disabled' };
  }
  
  if (!RESEND_API_KEY || !DEFAULT_FROM) {
    return { blocked: true, error: 'Missing RESEND_API_KEY or EMAIL_FROM' };
  }

  if (EMAIL_MODE === 'test') {
    const domain = to.split('@')[1]?.toLowerCase();
    if (!TEST_ALLOWED_DOMAINS.includes(domain) && !TEST_ALLOWED_DOMAINS.includes(to.toLowerCase())) {
      console.log(`[EMAIL TEST MODE] Blocked sending to unapproved recipient: ${to}`);
      return { blocked: true, error: 'Recipient not in TEST_ALLOWED_DOMAINS' };
    }
  }

  try {
    const headers = {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    };
    
    if (idempotencyKey) {
      headers['Idempotency-Key'] = idempotencyKey;
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers,
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

function getEmailConfigStatus() {
  return {
    mode: EMAIL_MODE,
    hasApiKey: !!RESEND_API_KEY,
    fromAddress: DEFAULT_FROM || 'NOT_CONFIGURED',
    testDomains: TEST_ALLOWED_DOMAINS.length
  };
}

module.exports = {
  enqueueEmail,
  sendEmailViaResend,
  getEmailConfigStatus,
  decryptPayload // Exported for the worker
};
