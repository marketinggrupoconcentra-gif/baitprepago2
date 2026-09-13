import { getDb, schema } from '@/db';
import { eq } from 'drizzle-orm';
import { encryptPII, decryptPII } from '@/lib/crypto';

const SENSITIVE_KEYS = new Set(['resend_api_key', 'meta_capi_access_token']);

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
