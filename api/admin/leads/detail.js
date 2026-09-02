/**
 * api/admin/leads/detail.js
 * GET /api/admin/leads/detail?id=123
 */

import { getDb } from '../../../lib/db.js';
import { requireAdminSession } from '../../../lib/admin-session.js';
import { ROLES, hasRole } from '../../../lib/admin-rbac.js';
import { maskPhone, sanitizeAdminUrl } from '../../../lib/leads-utils.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await requireAdminSession(req, res);
    if (!user) return; // 401 already sent

    if (!hasRole(user.role, [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.EDITOR, ROLES.VIEWER])) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const id = parseInt(url.searchParams.get('id'), 10);
    
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid lead ID' });
    }

    const sql = getDb();
    
    const results = await sql.query(`
      SELECT 
        id, phone, created_at,
        utm_source, utm_medium, utm_campaign, utm_content, utm_term,
        fb_ad_id, fb_adset_id, fb_campaign_id,
        page_url, referrer
      FROM leads
      WHERE id = $1
    `, [id]);
    
    const rows = results.rows || results;

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const lead = rows[0];

    const data = {
      id: lead.id,
      createdAt: lead.created_at,
      phoneMasked: maskPhone(lead.phone),
      utmSource: lead.utm_source,
      utmMedium: lead.utm_medium,
      utmCampaign: lead.utm_campaign,
      utmContent: lead.utm_content,
      utmTerm: lead.utm_term,
      fbAdId: lead.fb_ad_id,
      fbAdsetId: lead.fb_adset_id,
      fbCampaignId: lead.fb_campaign_id,
      page: sanitizeAdminUrl(lead.page_url),
      referrer: sanitizeAdminUrl(lead.referrer)
    };

    return res.status(200).json(data);

  } catch (err) {
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
