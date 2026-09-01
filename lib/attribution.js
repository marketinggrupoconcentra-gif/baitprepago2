import { truncate } from './validation.js';

export function parseAttribution(body, reqHeaders) {
  // UTMs de Google
  const utm_source   = truncate(body.utm_source);
  const utm_medium   = truncate(body.utm_medium);
  const utm_campaign = truncate(body.utm_campaign);
  const utm_content  = truncate(body.utm_content);
  const utm_term     = truncate(body.utm_term);

  // Parámetros de Meta (y GCLID)
  const fbclid         = truncate(body.fbclid, 512);
  const gclid          = truncate(body.gclid, 512);
  const fb_ad_id       = truncate(body.fb_ad_id);
  const fb_adset_id    = truncate(body.fb_adset_id);
  const fb_campaign_id = truncate(body.fb_campaign_id);

  // Metadatos del request
  const ip         = truncate(reqHeaders['x-real-ip'] || reqHeaders['x-forwarded-for'], 45);
  const user_agent = truncate(reqHeaders['user-agent'], 1000);
  const referrer   = truncate(body.referrer, 2048);
  const page_url   = truncate(body.page_url, 2048);

  return {
    utm_source, utm_medium, utm_campaign, utm_content, utm_term,
    fbclid, gclid, fb_ad_id, fb_adset_id, fb_campaign_id,
    ip, user_agent, referrer, page_url
  };
}
