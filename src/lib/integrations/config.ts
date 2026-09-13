/**
 * src/lib/integrations/config.ts — Configuración de integraciones de anuncios
 *
 * Fuente de verdad: app.settings (editable en /admin/settings → Integraciones).
 * Fallback: variables de entorno. Los secretos se guardan cifrados (ver
 * SENSITIVE_KEYS en src/lib/settings.ts) y la UI solo los muestra enmascarados.
 */
import { getSetting } from '@/lib/settings';

/** Claves de app.settings que usan las integraciones (documentación + validación). */
export const INTEGRATION_SETTING_KEYS = {
  googleAds: {
    developerToken:        'google_ads_developer_token',
    clientId:              'google_ads_client_id',
    clientSecret:          'google_ads_client_secret',
    refreshToken:          'google_ads_refresh_token',
    customerId:            'google_ads_account_id',
    loginCustomerId:       'google_ads_login_customer_id',
    campaignFilter:        'google_ads_campaign_filter',
    leadConversionAction:  'google_ads_conversion_action_id',
    wonConversionAction:   'google_ads_won_conversion_action_id',
  },
  meta: {
    pixelId:               'meta_pixel_id',
    capiAccessToken:       'meta_capi_access_token',
    testEventCode:         'meta_test_event_code',
  },
  conversions: {
    wonValueMxn:           'conversion_won_value',
  },
} as const;

export interface GoogleAdsConfig {
  developerToken: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** Customer ID sin guiones (10 dígitos). */
  customerId: string;
  /** MCC (opcional) si el acceso es vía cuenta administradora. */
  loginCustomerId?: string;
  campaignFilter?: string;
  /** Id numérico de la acción de conversión "Lead" (customers/<cid>/conversionActions/<id>). */
  leadConversionActionId?: string;
  wonConversionActionId?: string;
}

export interface MetaCapiConfig {
  pixelId: string;
  accessToken: string;
  testEventCode?: string;
}

const clean = (v: string | undefined) => (v ?? '').trim() || undefined;
const digits = (v: string | undefined) => (v ?? '').replace(/\D/g, '') || undefined;

/**
 * Credenciales de Google Ads. Compatibilidad con el contrato anterior:
 * GOOGLE_ADS_CREDENTIALS_B64 (JSON de OAuth client) alimenta client_id/secret si
 * no están en settings.
 */
export async function getGoogleAdsConfig(): Promise<GoogleAdsConfig | null> {
  const k = INTEGRATION_SETTING_KEYS.googleAds;
  const env = process.env;

  let envClientId: string | undefined;
  let envClientSecret: string | undefined;
  if (env.GOOGLE_ADS_CREDENTIALS_B64) {
    try {
      const raw = env.GOOGLE_ADS_CREDENTIALS_B64.trim();
      const json = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
      const parsed = JSON.parse(json);
      const c = parsed.installed ?? parsed.web ?? parsed;
      envClientId = c.client_id;
      envClientSecret = c.client_secret;
    } catch {
      // credenciales en env mal formadas → se ignoran (settings mandan)
    }
  }

  const [developerToken, clientId, clientSecret, refreshToken, customerId, loginCustomerId, campaignFilter, leadAction, wonAction] =
    await Promise.all([
      getSetting(k.developerToken, env.GOOGLE_ADS_DEVELOPER_TOKEN),
      getSetting(k.clientId, env.GOOGLE_ADS_OAUTH_CLIENT_ID ?? envClientId),
      getSetting(k.clientSecret, env.GOOGLE_ADS_OAUTH_CLIENT_SECRET ?? envClientSecret),
      getSetting(k.refreshToken, env.GOOGLE_ADS_REFRESH_TOKEN),
      getSetting(k.customerId, env.GOOGLE_ADS_ACCOUNT_ID),
      getSetting(k.loginCustomerId, env.GOOGLE_ADS_LOGIN_CUSTOMER_ID),
      getSetting(k.campaignFilter, env.GOOGLE_ADS_CAMPAIGN_FILTER),
      getSetting(k.leadConversionAction, env.GOOGLE_ADS_CONVERSION_ACTION_ID),
      getSetting(k.wonConversionAction, env.GOOGLE_ADS_WON_CONVERSION_ACTION_ID),
    ]);

  const cfg = {
    developerToken: clean(developerToken),
    clientId: clean(clientId),
    clientSecret: clean(clientSecret),
    refreshToken: clean(refreshToken),
    customerId: digits(customerId),
  };
  if (!cfg.developerToken || !cfg.clientId || !cfg.clientSecret || !cfg.refreshToken || !cfg.customerId) return null;

  return {
    developerToken: cfg.developerToken,
    clientId: cfg.clientId,
    clientSecret: cfg.clientSecret,
    refreshToken: cfg.refreshToken,
    customerId: cfg.customerId,
    loginCustomerId: digits(loginCustomerId),
    campaignFilter: clean(campaignFilter),
    leadConversionActionId: digits(leadAction),
    wonConversionActionId: digits(wonAction),
  };
}

export async function getMetaCapiConfig(): Promise<MetaCapiConfig | null> {
  const k = INTEGRATION_SETTING_KEYS.meta;
  const env = process.env;
  const [pixelId, accessToken, testEventCode] = await Promise.all([
    getSetting(k.pixelId, env.META_PIXEL_ID ?? env.NEXT_PUBLIC_META_PIXEL_ID),
    getSetting(k.capiAccessToken, env.META_CAPI_ACCESS_TOKEN),
    getSetting(k.testEventCode, env.META_TEST_EVENT_CODE),
  ]);
  const p = digits(pixelId);
  const t = clean(accessToken);
  if (!p || !t) return null;
  return { pixelId: p, accessToken: t, testEventCode: clean(testEventCode) };
}

/** Valor (MXN) que se reporta cuando una portabilidad se marca como ganada. */
export async function getWonConversionValue(): Promise<number> {
  const raw = await getSetting(INTEGRATION_SETTING_KEYS.conversions.wonValueMxn, process.env.CONVERSION_WON_VALUE);
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 100;
}
