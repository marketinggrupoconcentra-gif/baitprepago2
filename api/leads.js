import { getDb } from '../lib/db.js';
import { getDuplicatesDb } from '../lib/duplicates-db.js';
import { validateLeadPayload } from '../lib/validation.js';
import { checkRateLimit } from '../lib/security.js';
import { parseAttribution } from '../lib/attribution.js';
import { consumeCaptchaChallenge } from '../lib/captcha.js';

async function handleDuplicateLead(phone, email, attribution, duplicateOfLeadId) {
  let duplicatesSql;
  try {
    duplicatesSql = getDuplicatesDb();
  } catch (err) {
    console.error('[leads] Duplicates DB config missing:', err.message);
    // Fail-closed
    return { status: 503, json: { error: 'Service temporarily unavailable' } };
  }

  try {
    await duplicatesSql`
      INSERT INTO duplicate_leads (
        phone, email, duplicate_of_lead_id,
        utm_source, utm_medium, utm_campaign, utm_content, utm_term,
        fbclid, fb_ad_id, fb_adset_id, fb_campaign_id,
        ip, user_agent, referrer, page_url
      ) VALUES (
        ${phone}, ${email}, ${duplicateOfLeadId},
        ${attribution.utm_source}, ${attribution.utm_medium}, ${attribution.utm_campaign}, ${attribution.utm_content}, ${attribution.utm_term},
        ${attribution.fbclid}, ${attribution.fb_ad_id}, ${attribution.fb_adset_id}, ${attribution.fb_campaign_id},
        ${attribution.ip}, ${attribution.user_agent}, ${attribution.referrer}, ${attribution.page_url}
      )
    `;
    return {
      status: 409,
      json: { ok: false, error: 'duplicate_lead', code: 'PHONE_ALREADY_REGISTERED' }
    };
  } catch (err) {
    console.error('[leads] Duplicates DB Error:', err.message);
    // Fail closed
    return { status: 503, json: { error: 'Service temporarily unavailable' } };
  }
}

export default async function handler(req, res) {
  // CORS and Cache
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('application/json')) {
    return res.status(415).json({ error: 'Content-Type must be application/json' });
  }

  const body = req.body;
  if (!body) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  // 1. Validaciones (el código de portabilidad y su fecha de vigencia se validan y se descartan)
  const validation = validateLeadPayload(body);
  if (!validation.valid) {
    return res.status(422).json({ error: 'Invalid payload', details: validation.errors });
  }

  const { phone, email } = validation.data;

  // 2. Attribution
  const attribution = parseAttribution(body, req.headers);

  // 3. Conectar a Neon y aplicar reglas de seguridad
  let sql;
  try {
    sql = getDb();
  } catch (err) {
    console.error('[leads] DB config missing:', err.message);
    return res.status(500).json({ error: 'Internal configuration error' });
  }

  try {
    // 3b. CAPTCHA server-side (single use, consumed before insert)
    const captchaResult = await consumeCaptchaChallenge(
      sql,
      body.captcha_challenge_id,
      body.captcha_answer
    );
    if (!captchaResult.ok) {
      return res.status(422).json({ error: 'Invalid payload', details: [captchaResult.error] });
    }

    // 4. Rate Limiting (consultas a DB)
    const securityCheck = await checkRateLimit(sql, attribution.ip);
    if (!securityCheck.allowed) {
      if (securityCheck.reason === 'rate_limit') {
        return res.status(429).json({ error: 'Too many requests' });
      }
    }

    // 5. Pre-check para evitar fallos innecesarios en entornos donde ON CONFLICT no está activo aún,
    // y para optimizar si el duplicado ya existe.
    const existing = await sql`SELECT id FROM leads WHERE phone = ${phone} LIMIT 1`;
    if (existing.length > 0) {
      const duplicateRes = await handleDuplicateLead(phone, email, attribution, existing[0].id);
      return res.status(duplicateRes.status).json(duplicateRes.json);
    }

    // 6. Inserción race-safe
    const inserted = await sql`
      INSERT INTO leads (
        phone, email,
        utm_source, utm_medium, utm_campaign, utm_content, utm_term,
        fbclid, fb_ad_id, fb_adset_id, fb_campaign_id,
        ip, user_agent, referrer, page_url
      ) VALUES (
        ${phone}, ${email},
        ${attribution.utm_source}, ${attribution.utm_medium}, ${attribution.utm_campaign}, ${attribution.utm_content}, ${attribution.utm_term},
        ${attribution.fbclid}, ${attribution.fb_ad_id}, ${attribution.fb_adset_id}, ${attribution.fb_campaign_id},
        ${attribution.ip}, ${attribution.user_agent}, ${attribution.referrer}, ${attribution.page_url}
      )
      ON CONFLICT (phone) DO NOTHING
      RETURNING id
    `;

    if (inserted.length === 0) {
      // Duplicado concurrente detectado
      const concurrentExisting = await sql`SELECT id FROM leads WHERE phone = ${phone} LIMIT 1`;
      const duplicateRes = await handleDuplicateLead(phone, email, attribution, concurrentExisting[0]?.id || null);
      return res.status(duplicateRes.status).json(duplicateRes.json);
    }

    return res.status(201).json({ ok: true, saved: true });
  } catch (err) {
    console.error('[leads] DB Error:', err.message);
    // Soft fail to not leak internal DB errors
    return res.status(500).json({ error: 'Internal server error' });
  }
}
