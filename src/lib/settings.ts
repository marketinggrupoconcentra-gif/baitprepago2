import { getDb, schema } from '@/db';
import { eq } from 'drizzle-orm';
import { encryptPII, decryptPII } from '@/lib/crypto';

/** Claves editables desde /admin/settings. Cualquier otra clave se rechaza en la API. */
export const EDITABLE_SETTING_KEYS = [
  'gtm_id', 'ga4_id', 'meta_pixel_id',
  'meta_capi_access_token', 'meta_test_event_code',
  'resend_api_key',
  'google_ads_developer_token', 'google_ads_client_id', 'google_ads_client_secret', 'google_ads_refresh_token',
  'google_ads_account_id', 'google_ads_login_customer_id', 'google_ads_campaign_filter',
  'google_ads_conversion_action_id', 'google_ads_won_conversion_action_id',
  'conversion_won_value',
] as const;

/** Secretos: cifrados en reposo (AES-256-GCM) y enmascarados en la UI. */
export const SENSITIVE_KEYS = new Set<string>([
  'resend_api_key',
  'meta_capi_access_token',
  'google_ads_developer_token',
  'google_ads_client_secret',
  'google_ads_refresh_token',
]);

export const MASKED_VALUE = '••••••••••••••••';

/**
 * Obtiene un ajuste desde la base de datos (app.settings) por su clave.
 * Si no se encuentra, retorna el envFallback provisto o undefined.
 */
export async function getSetting(key: string, envFallback?: string): Promise<string | undefined> {
  try {
    const db = getDb();
    const [row] = await db.select({ value: schema.settings.value })
      .from(schema.settings)
      .where(eq(schema.settings.key, key));
      
    if (row && row.value) {
      if (SENSITIVE_KEYS.has(key)) {
        try {
          return decryptPII(row.value);
        } catch {
          // Fallback if the key was saved in plain text previously
          return row.value;
        }
      }
      return row.value;
    }
  } catch (err) {
    console.error(`Error fetching setting ${key}:`, err);
  }
  
  return envFallback;
}

/**
 * Guarda o actualiza un ajuste en la base de datos, encriptando si es sensible.
 */
export async function setSetting(key: string, value: string | null): Promise<void> {
  const db = getDb();

  if (value === null || value === '') {
    await db.delete(schema.settings).where(eq(schema.settings.key, key));
    return;
  }

  let finalValue = value;
  if (SENSITIVE_KEYS.has(key)) {
    finalValue = encryptPII(value);
  }

  await db.insert(schema.settings)
    .values({
      key,
      value: finalValue,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.settings.key,
      set: {
        value: finalValue,
        updatedAt: new Date(),
      }
    });
}
