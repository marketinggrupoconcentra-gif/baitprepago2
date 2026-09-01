import { getDb } from '../lib/db.js';
import { validateLeadPayload } from '../lib/validation.js';
import { checkRateLimitAndIdempotency } from '../lib/security.js';
import { parseAttribution } from '../lib/attribution.js';

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

  // 1. Validaciones
  const validation = validateLeadPayload(body);
  if (!validation.valid) {
    return res.status(422).json({ error: 'Invalid payload', details: validation.errors });
  }

  const { phone } = validation.data; // NIP is completely ignored here, not extracted
  
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
    // 4. Rate Limiting e Idempotencia (consultas a DB)
    const securityCheck = await checkRateLimitAndIdempotency(sql, attribution.ip, phone);
    if (!securityCheck.allowed) {
      if (securityCheck.reason === 'rate_limit') {
        return res.status(429).json({ error: 'Too many requests' });
      }
      if (securityCheck.reason === 'idempotent') {
        // Idempotency usually returns success but doesn't create a new record
        return res.status(200).json({ ok: true, saved: true, note: 'idempotent' });
      }
    }

    // 5. Inserción
    // Nota: NIP no se persiste en la DB, se omitió del schema.
    await sql`
      INSERT INTO leads (
        phone,
        utm_source, utm_medium, utm_campaign, utm_content, utm_term,
        fbclid, fb_ad_id, fb_adset_id, fb_campaign_id,
        ip, user_agent, referrer, page_url
      ) VALUES (
        ${phone},
        ${attribution.utm_source}, ${attribution.utm_medium}, ${attribution.utm_campaign}, ${attribution.utm_content}, ${attribution.utm_term},
        ${attribution.fbclid}, ${attribution.fb_ad_id}, ${attribution.fb_adset_id}, ${attribution.fb_campaign_id},
        ${attribution.ip}, ${attribution.user_agent}, ${attribution.referrer}, ${attribution.page_url}
      )
    `;

    return res.status(201).json({ ok: true, saved: true });
  } catch (err) {
    console.error('[leads] DB Error:', err.message);
    // Soft fail to not leak internal DB errors
    return res.status(500).json({ error: 'Internal server error' });
  }
}
