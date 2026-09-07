/**
 * api/captcha/challenge.js
 * POST /api/captcha/challenge
 *
 * Issues a server-generated CAPTCHA challenge. Only an HMAC hash of the
 * answer is persisted (captcha_challenges.answer_hash); the plaintext
 * answer is never returned, logged, or stored.
 */

import { getDb } from '../../lib/db.js';
import { createCaptchaChallenge } from '../../lib/captcha.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('application/json')) {
    return res.status(415).json({ error: 'Content-Type must be application/json' });
  }

  let sql;
  try {
    sql = getDb();
  } catch (err) {
    console.error('[captcha/challenge] DB config missing:', err.message);
    return res.status(500).json({ error: 'Internal configuration error' });
  }

  try {
    const challenge = await createCaptchaChallenge(sql);
    return res.status(201).json(challenge);
  } catch (err) {
    // Fail closed: if CAPTCHA_PEPPER is missing this throws before any DB
    // write, and we must not leak the reason to the client.
    console.error('[captcha/challenge] Error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
