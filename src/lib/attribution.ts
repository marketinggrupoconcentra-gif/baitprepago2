// ── Attribution Utilities ───────────────────────────────────────────────────

export type SourceCategory =
  | 'google_ads'
  | 'meta_ads'
  | 'paid_other'
  | 'organic'
  | 'referral'
  | 'direct'
  | 'other';

export interface AttributionInput {
  gclidPresent?: boolean;
  gbraidPresent?: boolean;
  wbraidPresent?: boolean;
  fbclidPresent?: boolean;
  utmSource?: string;
  utmMedium?: string;
  referrerHost?: string;
}

const ORGANIC_SEARCH_DOMAINS = new Set([
  'google.com', 'google.com.mx', 'bing.com', 'yahoo.com',
  'duckduckgo.com', 'yandex.com', 'baidu.com', 'ask.com',
]);

const PAID_MEDIUMS = new Set([
  'cpc', 'ppc', 'paidsearch', 'paid', 'display',
  'cpm', 'cpv', 'social_paid', 'paid_social', 'banner',
]);

/**
 * Determina source_category server-side.
 * Prioridad según el prompt:
 * 1. gclid / gbraid / wbraid → google_ads
 * 2. fbclid → meta_ads
 * 3. UTM con medio pagado → paid_other
 * 4. referrer de buscador (sin id pagado) → organic
 * 5. referrer externo → referral
 * 6. sin referrer ni campaña → direct
 * 7. cualquier otro → other
 */
export function resolveSourceCategory(input: AttributionInput): SourceCategory {
  // 1. Google Ads click identifiers
  if (input.gclidPresent || input.gbraidPresent || input.wbraidPresent) {
    return 'google_ads';
  }

  // 2. Meta Ads click identifier
  if (input.fbclidPresent) {
    return 'meta_ads';
  }

  // 3. UTM con medio pagado
  const medium = (input.utmMedium ?? '').toLowerCase().trim();
  if (medium && PAID_MEDIUMS.has(medium)) {
    // Si el source es google → google_ads (sin gclid pero UTM correcto)
    const source = (input.utmSource ?? '').toLowerCase();
    if (source.includes('google')) return 'google_ads';
    if (source.includes('facebook') || source.includes('instagram') || source.includes('meta')) return 'meta_ads';
    return 'paid_other';
  }

  // 4. Referrer de buscador (tráfico orgánico)
  if (input.referrerHost) {
    const host = input.referrerHost.toLowerCase().replace(/^www\./, '');
    if (ORGANIC_SEARCH_DOMAINS.has(host)) {
      return 'organic';
    }
    // 5. Referrer externo (social orgánico, otros sitios)
    return 'referral';
  }

  // 6. UTM presente sin referrer y sin id pagado → otro origen de campaña
  if (input.utmSource || input.utmMedium) {
    return 'other';
  }

  // 7. Sin nada → directo
  return 'direct';
}

// ── Parseo de parámetros de URL ───────────────────────────────────────────────

export interface UtmParams {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
}

export interface ClickIds {
  gclidPresent: boolean;
  gbraidPresent: boolean;
  wbraidPresent: boolean;
  fbclidPresent: boolean;
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
  fbclid?: string;
}

export function parseUtmParams(url: string): UtmParams {
  try {
    const u = new URL(url);
    return {
      utmSource:   u.searchParams.get('utm_source') ?? undefined,
      utmMedium:   u.searchParams.get('utm_medium') ?? undefined,
      utmCampaign: u.searchParams.get('utm_campaign') ?? undefined,
      utmTerm:     u.searchParams.get('utm_term') ?? undefined,
      utmContent:  u.searchParams.get('utm_content') ?? undefined,
    };
  } catch {
    return {};
  }
}

export function parseClickIds(url: string): ClickIds {
  try {
    const u = new URL(url);
    return {
      gclidPresent:  u.searchParams.has('gclid'),
      gbraidPresent: u.searchParams.has('gbraid'),
      wbraidPresent: u.searchParams.has('wbraid'),
      fbclidPresent: u.searchParams.has('fbclid'),
      gclid:         u.searchParams.get('gclid') ?? undefined,
      gbraid:        u.searchParams.get('gbraid') ?? undefined,
      wbraid:        u.searchParams.get('wbraid') ?? undefined,
      fbclid:        u.searchParams.get('fbclid') ?? undefined,
    };
  } catch {
    return { gclidPresent: false, gbraidPresent: false, wbraidPresent: false, fbclidPresent: false };
  }
}

export function extractReferrerHost(referrer: string | undefined | null): string | undefined {
  if (!referrer) return undefined;
  try {
    return new URL(referrer).hostname.replace(/^www\./, '') || undefined;
  } catch {
    return undefined;
  }
}
