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
  'intelix_api_url', 'intelix_api_key', 'intelix_capturista', 'intelix_compania', 'intelix_chat_id',
] as const;

/** Secretos: cifrados en reposo (AES-256-GCM) y enmascarados en la UI. */
export const SENSITIVE_KEYS = new Set<string>([
  'resend_api_key',
  'intelix_api_key',
  'meta_capi_access_token',
  'google_ads_developer_token',
  'google_ads_client_secret',
  'google_ads_refresh_token',
]);

export const MASKED_VALUE = '••••••••••••••••';

/**
 * Reglas de formato por clave (se aplican al guardar; vacío = borrar el ajuste).
 * Devuelven un mensaje de error o null si el valor es válido.
 */
export const SETTING_VALIDATORS: Partial<Record<(typeof EDITABLE_SETTING_KEYS)[number], (v: string) => string | null>> = {
  intelix_capturista: (v) => (/^\d+$/.test(v) ? null : 'El capturista debe contener solo números.'),
  intelix_chat_id: (v) => (/^\d+$/.test(v) ? null : 'chat_id debe ser un número entero.'),
  intelix_api_url: (v) => (/^https:\/\/\S+$/.test(v) ? null : 'La URL debe empezar por https://.'),
  intelix_compania: (v) => (/^[a-z0-9_-]{2,40}$/i.test(v) ? null : 'Compañía: solo letras/números (2-40).'),
  google_ads_account_id: (v) => (/^\d{3}-?\d{3}-?\d{4}$/.test(v) ? null : 'Customer ID con formato 123-456-7890.'),
  google_ads_login_customer_id: (v) => (/^\d{3}-?\d{3}-?\d{4}$/.test(v) ? null : 'MCC con formato 123-456-7890.'),
  google_ads_conversion_action_id: (v) => (/^\d+$/.test(v) ? null : 'El id de la acción de conversión es numérico.'),
  google_ads_won_conversion_action_id: (v) => (/^\d+$/.test(v) ? null : 'El id de la acción de conversión es numérico.'),
  conversion_won_value: (v) => (/^\d+(\.\d{1,2})?$/.test(v) ? null : 'Valor en MXN (p. ej. 100 o 99.50).'),
  meta_pixel_id: (v) => (/^\d{5,20}$/.test(v) ? null : 'El Pixel ID es numérico.'),
  gtm_id: (v) => (/^GTM-[A-Z0-9]{4,10}$/.test(v) ? null : 'Formato GTM-XXXXXXX.'),
  ga4_id: (v) => (/^G-[A-Z0-9]{5,15}$/.test(v) ? null : 'Formato G-XXXXXXXX.'),
};

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
