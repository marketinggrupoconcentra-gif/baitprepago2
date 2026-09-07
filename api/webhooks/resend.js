const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');

/**
 * Validates a Svix webhook signature.
 * @param {string} payload - Raw request body
 * @param {object} headers - Request headers
 * @param {string} secret - Webhook secret with 'whsec_' prefix
 */
function verifySvixSignature(payload, headers, secret) {
  const msgId = headers['webhook-id'];
  const msgTimestamp = headers['webhook-timestamp'];
  const msgSignature = headers['webhook-signature'];

  if (!msgId || !msgTimestamp || !msgSignature) {
    throw new Error('Faltan headers de Svix');
  }

  // Check timestamp to prevent replay attacks (tolerance 5 mins)
  const now = Math.floor(Date.now() / 1000);
  if (now - parseInt(msgTimestamp, 10) > 300) {
    throw new Error('Timestamp expirado');
  }

  const toSign = `${msgId}.${msgTimestamp}.${payload}`;
  
  // Svix secrets start with 'whsec_', we need the base64 decoded bytes
  const secretBytes = Buffer.from(secret.replace('whsec_', ''), 'base64');
  
  const expectedSignature = crypto
    .createHmac('sha256', secretBytes)
    .update(toSign)
    .digest('base64');

  // msgSignature can contain multiple signatures separated by space (e.g. v1,sig1 v1,sig2)
  const signatures = msgSignature.split(' ').map(s => s.split(',')[1]);
  
  if (!signatures.includes(expectedSignature)) {
    throw new Error('Firma inválida');
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    console.warn('RESEND_WEBHOOK_SECRET no configurado');
    return res.status(500).json({ error: 'Configuración incompleta' });
  }

  // To verify signature we need the raw body. 
  // Vercel bodyParser is disabled via config, so req is a stream
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const payloadStr = Buffer.concat(chunks).toString('utf-8');

  try {
    verifySvixSignature(payloadStr, req.headers, secret);
  } catch (err) {
    console.error('Error verificando firma webhook:', err.message);
    return res.status(400).json({ error: 'Firma inválida' });
  }

  const event = JSON.parse(payloadStr);
  const sql = neon(process.env.DATABASE_URL);

  try {
    const { type, data } = event;
    const emailId = data.email_id;
    
    if (type === 'email.delivered') {
      await sql`
        UPDATE email_outbox 
        SET status = 'SENT', updated_at = NOW() 
        WHERE resend_id = ${emailId}
      `;
    } else if (type === 'email.bounced') {
      await sql`
        UPDATE email_outbox 
        SET status = 'FAILED', error = ${data.reason || 'Bounced'}, updated_at = NOW() 
        WHERE resend_id = ${emailId}
      `;
      // Mark as suppression
      if (data.to && data.to[0]) {
        await sql`
          INSERT INTO email_suppressions (email, reason) 
          VALUES (${data.to[0]}, 'BOUNCED')
          ON CONFLICT (email) DO NOTHING
        `;
      }
    } else if (type === 'email.complained') {
       await sql`
        UPDATE email_outbox 
        SET status = 'FAILED', error = 'Complained (Spam)', updated_at = NOW() 
        WHERE resend_id = ${emailId}
      `;
      if (data.to && data.to[0]) {
        await sql`
          INSERT INTO email_suppressions (email, reason) 
          VALUES (${data.to[0]}, 'COMPLAINED')
          ON CONFLICT (email) DO NOTHING
        `;
      }
    }
    
    // Always log the event
    await sql`
      INSERT INTO email_delivery_events (resend_id, event_type, details)
      VALUES (${emailId}, ${type}, ${JSON.stringify(data)}::jsonb)
    `;

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Error procesando webhook Resend:', err);
    return res.status(500).json({ error: 'Error interno procesando webhook' });
  }
};

module.exports.config = {
  api: {
    bodyParser: false,
  },
};
