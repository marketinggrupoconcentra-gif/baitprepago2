/**
 * src/app/admin/(console)/settings/page.tsx — Configuración
 *
 * Diseño: "Configuración.dc.html" (Claude Design).
 *
 * IMPORTANTE: BAIT no tiene almacén de configuración editable en runtime. La
 * config vive en variables de entorno, en el código y en Neon Auth (por diseño
 * de seguridad — Etapa 2.2). Esta pantalla es INFORMATIVA / solo lectura: cada
 * campo muestra el valor real actual y de dónde sale. Los estados de integración
 * se calculan server-side desde process.env sin exponer secretos.
 */
import { Metadata } from 'next';
import { requireAdminSessionOrRedirect } from '@/lib/session';
import { BUSINESS_TIMEZONE } from '@/db/index';
import { MAX_ATTEMPTS } from '@/lib/outbox/claim';
import SettingsClient, { type IntegrationStatus } from '@/components/admin/SettingsClient';
import { getDb, schema } from '@/db';
import { eq } from 'drizzle-orm';

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
    const keys = ['gtm_id', 'ga4_id', 'meta_pixel_id', 'meta_capi_access_token', 'resend_api_key', 'intelix_api_url', 'intelix_api_key', 'google_ads_account_id', 'google_ads_access_token', 'google_ads_campaign_filter'];
    const rows = await db.select({ key: schema.settings.key, value: schema.settings.value }).from(schema.settings);
    rows.forEach(r => {
      if (r.value) dbSettings[r.key] = r.value;
    });
  } catch (err) {}

  const v = (key: string, envKey: string) => dbSettings[key] || env[envKey] || '';
  const metaStatus = (key: string, envKey: string) => dbSettings[key] ? 'Configurado en BD' : envKey;
  const mask = (val: string) => val ? '••••••••••••••••' : '';

  const integrations = [
    { key: 'landing', label: 'Landing BAIT Prepago', meta: 'eventos propios (app.analytics_events)', status: 'CONFIGURED' as IntegrationStatus },
    { key: 'gtm', label: 'Google Tag Manager', meta: metaStatus('gtm_id', 'NEXT_PUBLIC_GTM_ID'), status: status(v('gtm_id', 'NEXT_PUBLIC_GTM_ID')), configKeys: [{ label: 'GTM ID', dbKey: 'gtm_id', val: v('gtm_id', 'NEXT_PUBLIC_GTM_ID'), ph: 'GTM-XXXXXXX' }] },
    { key: 'ga4', label: 'Google Analytics 4', meta: metaStatus('ga4_id', 'NEXT_PUBLIC_GA4_ID'), status: status(v('ga4_id', 'NEXT_PUBLIC_GA4_ID')), configKeys: [{ label: 'GA4 ID', dbKey: 'ga4_id', val: v('ga4_id', 'NEXT_PUBLIC_GA4_ID'), ph: 'G-XXXXXXXX' }] },
    { key: 'meta_pixel', label: 'Meta Pixel', meta: metaStatus('meta_pixel_id', 'NEXT_PUBLIC_META_PIXEL_ID'), status: status(v('meta_pixel_id', 'NEXT_PUBLIC_META_PIXEL_ID')), configKeys: [{ label: 'Pixel ID', dbKey: 'meta_pixel_id', val: v('meta_pixel_id', 'NEXT_PUBLIC_META_PIXEL_ID'), ph: 'XXXXXXXXXXXXXX' }] },
    { key: 'meta_capi', label: 'Meta Conversions API', meta: metaStatus('meta_capi_access_token', 'META_CAPI_ACCESS_TOKEN'), status: status(v('meta_capi_access_token', 'META_CAPI_ACCESS_TOKEN')), configKeys: [{ label: 'Token', dbKey: 'meta_capi_access_token', val: mask(v('meta_capi_access_token', 'META_CAPI_ACCESS_TOKEN')), ph: 'EAAB...' }] },
    { key: 'resend', label: 'Resend (reportes por email)', meta: metaStatus('resend_api_key', 'RESEND_API_KEY'), status: status(v('resend_api_key', 'RESEND_API_KEY')), configKeys: [{ label: 'API Key', dbKey: 'resend_api_key', val: mask(v('resend_api_key', 'RESEND_API_KEY')), ph: 're_...' }] },
    { key: 'intelix', label: 'Intelix (CRM downstream)', meta: (dbSettings['intelix_api_url'] || dbSettings['intelix_api_key']) ? 'Configurado en BD' : 'INTELIX_API_URL · INTELIX_API_KEY', status: status(v('intelix_api_url', 'INTELIX_API_URL'), v('intelix_api_key', 'INTELIX_API_KEY')), configKeys: [
      { label: 'URL', dbKey: 'intelix_api_url', val: v('intelix_api_url', 'INTELIX_API_URL'), ph: 'https://...' },
      { label: 'API Key', dbKey: 'intelix_api_key', val: mask(v('intelix_api_key', 'INTELIX_API_KEY')), ph: 'ey...' }
    ] },
    { key: 'google_ads', label: 'Google Ads', meta: (dbSettings['google_ads_account_id'] || dbSettings['google_ads_access_token']) ? 'Configurado en BD' : 'Métricas y Rendimiento SEM', status: status(v('google_ads_account_id', 'GOOGLE_ADS_ACCOUNT_ID'), v('google_ads_access_token', 'GOOGLE_ADS_ACCESS_TOKEN')), configKeys: [
      { label: 'Account ID', dbKey: 'google_ads_account_id', val: v('google_ads_account_id', 'GOOGLE_ADS_ACCOUNT_ID'), ph: '123-456-7890' },
      { label: 'Access Token', dbKey: 'google_ads_access_token', val: mask(v('google_ads_access_token', 'GOOGLE_ADS_ACCESS_TOKEN')), ph: 'ya29...' },
      { label: 'Keyword Filter', dbKey: 'google_ads_campaign_filter', val: v('google_ads_campaign_filter', 'GOOGLE_ADS_CAMPAIGN_FILTER'), ph: 'Ej: Bait' }
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
