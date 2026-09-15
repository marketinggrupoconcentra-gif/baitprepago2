/**
 * src/app/admin/(console)/settings/page.tsx — Configuración
 *
 * Integraciones: los valores viven en app.settings (editables aquí) con
 * fallback a variables de entorno. Los secretos se guardan cifrados y solo se
 * muestran enmascarados; el estado se calcula server-side sin exponerlos.
 */
import { Metadata } from 'next';
import { requireAdminSessionOrRedirect } from '@/lib/session';
import { BUSINESS_TIMEZONE } from '@/db/index';
import SettingsClient, { type IntegrationStatus } from '@/components/admin/SettingsClient';
import { getDb, schema } from '@/db';
import { MASKED_VALUE, SENSITIVE_KEYS } from '@/lib/settings';
import { conversionQueueStats } from '@/lib/conversions/queue';
import { INTELIX_DEFAULTS } from '@/lib/integrations/config';
import { MAX_ATTEMPTS } from '@/lib/outbox/claim';
import { sql } from 'drizzle-orm';

export const metadata: Metadata = { title: 'Configuración' };

function status(...vars: (string | undefined)[]): IntegrationStatus {
  const present = vars.filter((v) => v && v.trim().length > 0).length;
  if (present === 0) return 'NOT_CONFIGURED';
  if (present === vars.length) return 'CONFIGURED';
  return 'PARTIAL';
}

export default async function SettingsPage() {
  const session = await requireAdminSessionOrRedirect();
  const env = process.env;
  const db = getDb();
  
  const dbSettings: Record<string, string> = {};
  try {
    const rows = await db.select({ key: schema.settings.key, value: schema.settings.value }).from(schema.settings);
    rows.forEach((r) => {
      // Secretos: solo importa si existen (nunca se descifran para la UI)
      if (r.value) dbSettings[r.key] = SENSITIVE_KEYS.has(r.key) ? MASKED_VALUE : r.value;
    });
  } catch {
    // sin acceso a app.settings → se muestran solo las variables de entorno
  }

  let outboxSummary = 'sin envíos registrados';
  try {
    const rows = await db.select({ status: schema.deliveryOutbox.status, n: sql<number>`count(*)::int` }).from(schema.deliveryOutbox).groupBy(schema.deliveryOutbox.status);
    if (rows.length) {
      const n = (st: string) => rows.find((r) => r.status === st)?.n ?? 0;
      outboxSummary = `entregados ${n('delivered')} · pendientes ${n('pending') + n('processing') + n('failed')} · muertos ${n('dead')}`;
    }
  } catch { /* sin acceso */ }

  let conversionStats: { provider: string; status: string; n: number }[] = [];
  try { conversionStats = await conversionQueueStats(); } catch { /* tabla vacía o sin acceso */ }
  const convSummary = (provider: string) => {
    const rows = conversionStats.filter((r) => r.provider === provider);
    if (rows.length === 0) return 'sin conversiones encoladas aún';
    const n = (st: string) => rows.find((r) => r.status === st)?.n ?? 0;
    return `enviadas ${n('sent')} · pendientes ${n('pending')} · fallidas ${n('dead')} · omitidas ${n('skipped')}`;
  };

  const v = (key: string, envKey: string) => dbSettings[key] || env[envKey] || '';
  const metaStatus = (key: string, envKey: string) => dbSettings[key] ? 'Configurado en BD' : envKey;
  const mask = (val: string) => val ? MASKED_VALUE : '';
  const secret = (label: string, dbKey: string, envKey: string, help?: string) => ({ label, dbKey, val: mask(v(dbKey, envKey)), ph: 'sin configurar', secret: true, help });
  const plain = (label: string, dbKey: string, envKey: string, ph: string, help?: string) => ({ label, dbKey, val: v(dbKey, envKey), ph, help });
  const numeric = (label: string, dbKey: string, envKey: string, ph: string, help?: string) => ({ ...plain(label, dbKey, envKey, ph, help), numeric: true });

  const integrations = [
    { key: 'landing', label: 'Landing BAIT Prepago', meta: 'eventos propios (app.analytics_events)', status: 'CONFIGURED' as IntegrationStatus },
    { key: 'gtm', label: 'Google Tag Manager', meta: metaStatus('gtm_id', 'NEXT_PUBLIC_GTM_ID'), status: status(v('gtm_id', 'NEXT_PUBLIC_GTM_ID')), configKeys: [{ label: 'GTM ID', dbKey: 'gtm_id', val: v('gtm_id', 'NEXT_PUBLIC_GTM_ID'), ph: 'GTM-XXXXXXX' }] },
    { key: 'ga4', label: 'Google Analytics 4', meta: metaStatus('ga4_id', 'NEXT_PUBLIC_GA4_ID'), status: status(v('ga4_id', 'NEXT_PUBLIC_GA4_ID')), configKeys: [{ label: 'GA4 ID', dbKey: 'ga4_id', val: v('ga4_id', 'NEXT_PUBLIC_GA4_ID'), ph: 'G-XXXXXXXX' }] },
    { key: 'meta_pixel', label: 'Meta Pixel', meta: metaStatus('meta_pixel_id', 'NEXT_PUBLIC_META_PIXEL_ID'), status: status(v('meta_pixel_id', 'NEXT_PUBLIC_META_PIXEL_ID')), configKeys: [{ label: 'Pixel ID', dbKey: 'meta_pixel_id', val: v('meta_pixel_id', 'NEXT_PUBLIC_META_PIXEL_ID'), ph: 'XXXXXXXXXXXXXX' }] },
    { key: 'meta_capi', label: 'Meta Conversions API', meta: `${metaStatus('meta_capi_access_token', 'META_CAPI_ACCESS_TOKEN')} · ${convSummary('meta_capi')}`, status: status(v('meta_pixel_id', 'NEXT_PUBLIC_META_PIXEL_ID'), v('meta_capi_access_token', 'META_CAPI_ACCESS_TOKEN')), configKeys: [
      secret('Token de acceso (CAPI)', 'meta_capi_access_token', 'META_CAPI_ACCESS_TOKEN', 'Events Manager → Pixel → Configuración → Conversions API → Generar token.'),
      plain('Test event code', 'meta_test_event_code', 'META_TEST_EVENT_CODE', 'TEST12345', 'Solo para probar en Events Manager → "Probar eventos". Vaciar en producción.'),
    ] },
    { key: 'brevo', label: 'Brevo (email transaccional)', meta: metaStatus('brevo_api_key', 'BREVO_API_KEY'), status: status(v('brevo_api_key', 'BREVO_API_KEY')), configKeys: [{ label: 'API Key', dbKey: 'brevo_api_key', val: mask(v('brevo_api_key', 'BREVO_API_KEY')), ph: 'xkeysib-...' }] },
    { key: 'google_ads', label: 'Google Ads', meta: `métricas SEM + conversiones offline · ${convSummary('google_ads')}`, status: status(v('google_ads_developer_token', 'GOOGLE_ADS_DEVELOPER_TOKEN'), v('google_ads_client_id', 'GOOGLE_ADS_OAUTH_CLIENT_ID'), v('google_ads_client_secret', 'GOOGLE_ADS_OAUTH_CLIENT_SECRET'), v('google_ads_refresh_token', 'GOOGLE_ADS_REFRESH_TOKEN'), v('google_ads_account_id', 'GOOGLE_ADS_ACCOUNT_ID')), configKeys: [
      plain('Customer ID', 'google_ads_account_id', 'GOOGLE_ADS_ACCOUNT_ID', '123-456-7890', 'Id de la cuenta de Google Ads (arriba a la derecha en Ads).'),
      plain('Login customer ID (MCC)', 'google_ads_login_customer_id', 'GOOGLE_ADS_LOGIN_CUSTOMER_ID', '', 'Solo si accedes vía cuenta administradora.'),
      secret('Developer token', 'google_ads_developer_token', 'GOOGLE_ADS_DEVELOPER_TOKEN', 'Google Ads → Herramientas → Centro de API.'),
      plain('OAuth client ID', 'google_ads_client_id', 'GOOGLE_ADS_OAUTH_CLIENT_ID', '....apps.googleusercontent.com', 'Google Cloud → Credenciales → OAuth 2.0 (tipo Escritorio).'),
      secret('OAuth client secret', 'google_ads_client_secret', 'GOOGLE_ADS_OAUTH_CLIENT_SECRET'),
      secret('Refresh token', 'google_ads_refresh_token', 'GOOGLE_ADS_REFRESH_TOKEN', 'Genera con: node scripts/get-refresh-token.mjs'),
      numeric('Conversión "Lead" (id)', 'google_ads_conversion_action_id', 'GOOGLE_ADS_CONVERSION_ACTION_ID', '123456789', 'Id numérico de la acción de conversión (Objetivos → Conversiones → la acción → URL: ctId=...). Origen: Importar / clics de anuncios.'),
      numeric('Conversión "Portabilidad ganada" (id)', 'google_ads_won_conversion_action_id', 'GOOGLE_ADS_WON_CONVERSION_ACTION_ID', '', 'Opcional. Se sube cuando un lead pasa a estado comercial Ganado.'),
      plain('Filtro de campañas', 'google_ads_campaign_filter', 'GOOGLE_ADS_CAMPAIGN_FILTER', 'Ej: Bait', 'Solo campañas cuyo nombre contenga este texto (métricas SEM).'),
    ] },
    { key: 'intelix', label: 'Intelix (CRM de portabilidad)', meta: `outbox cada 5 min · ${outboxSummary}`, status: status(v('intelix_api_url', 'INTELIX_API_URL') || INTELIX_DEFAULTS.apiUrl), configKeys: [
      plain('URL del endpoint', 'intelix_api_url', 'INTELIX_API_URL', INTELIX_DEFAULTS.apiUrl, `Vacío = ${INTELIX_DEFAULTS.apiUrl}`),
      secret('API key', 'intelix_api_key', 'INTELIX_API_KEY', 'Opcional: se envía como Authorization: Bearer si existe.'),
      numeric('Capturista', 'intelix_capturista', 'INTELIX_CAPTURISTA', INTELIX_DEFAULTS.capturista, 'Id de capturista que Intelix asocia a los registros web. Solo números, sin longitud fija.'),
      plain('Compañía', 'intelix_compania', 'INTELIX_COMPANIA', INTELIX_DEFAULTS.compania, 'Compañía de origen que se envía en cada registro (el formulario no la pregunta).'),
      numeric('chat_id', 'intelix_chat_id', 'INTELIX_CHAT_ID', String(INTELIX_DEFAULTS.chatId), 'Identificador de canal que espera el endpoint. Solo números.'),
    ] },
    { key: 'conversions', label: 'Valor de conversión', meta: 'MXN por portabilidad ganada (Google Ads / Meta)', status: 'CONFIGURED' as IntegrationStatus, configKeys: [
      plain('Valor (MXN)', 'conversion_won_value', 'CONVERSION_WON_VALUE', '100', 'Se envía como valor de la conversión "won". Default 100.'),
    ] },
  ];

  const systemInfo = {
    appUrl: env.APP_URL ?? null,
    allowedOrigins: (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    environment: env.VERCEL_ENV ?? env.NODE_ENV ?? 'unknown',
    commit: (env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7) || null,
    timezone: BUSINESS_TIMEZONE,
    authProvider: 'Neon Auth (managed)',
    privacyPolicyVersion: env.PRIVACY_POLICY_VERSION ?? null,
    termsVersion: env.TERMS_VERSION ?? null,
    maxDeliveryAttempts: MAX_ATTEMPTS,
  };

  // Campos reales del formulario de portabilidad (public/assets/site.js → src/lib/validators/lead-schema.ts)
  const formFields = [
    { label: 'Número a portar', key: 'phone', visible: true, required: true, locked: true },
    { label: 'NIP de portabilidad (no se persiste)', key: 'nip', visible: true, required: true, locked: true },
    { label: 'Vigencia del NIP', key: 'nip_valid_until', visible: true, required: false, conditional: true, locked: true },
    { label: 'Nombre(s)', key: 'nombre', visible: true, required: true, locked: true },
    { label: 'Apellido(s)', key: 'apellido', visible: true, required: true, locked: true },
    { label: 'Correo electrónico', key: 'email', visible: true, required: true, locked: true },
    { label: 'Código de seguridad (CAPTCHA)', key: 'captcha', visible: true, required: true, locked: true },
    { label: 'Aviso de Privacidad', key: 'consent', visible: true, required: true, locked: true },
  ];

  return (
    <SettingsClient
      session={session}
      integrations={integrations}
      systemInfo={systemInfo}
      formFields={formFields}
    />
  );
}
