/**
 * lib/leads-utils.js
 * Helpers para formateo de PII y seguridad de Leads.
 */

/**
 * Enmascara un número de teléfono dejando solo los últimos 4 dígitos visibles.
 * @param {string} phone 
 * @returns {string}
 */
export function maskPhone(phone) {
  if (!phone) return '';
  const strPhone = String(phone);
  
  if (strPhone.length <= 4) {
    return '*'.repeat(strPhone.length);
  }
  
  const visible = strPhone.slice(-4);
  const masked = '*'.repeat(strPhone.length - 4);
  return masked + visible;
}

/**
 * Sanitiza una URL para evitar inyección XSS, javascript: links, querystrings y fragments.
 * @param {string} url 
 * @returns {string|null}
 */
export function sanitizeAdminUrl(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    // Remove query, hash, credentials
    parsed.search = '';
    parsed.hash = '';
    parsed.username = '';
    parsed.password = '';
    return parsed.toString().replace(/\/$/, ''); // Optionally remove trailing slash
  } catch (err) {
    return null;
  }
}

/**
 * Codifica un cursor (objeto JSON) en Base64url seguro.
 * @param {Object} obj 
 * @returns {string}
 */
export function encodeCursor(obj) {
  if (!obj) return '';
  try {
    const str = JSON.stringify(obj);
    return Buffer.from(str).toString('base64url');
  } catch (err) {
    return '';
  }
}

/**
 * Decodifica y valida estrictamente un cursor Base64url.
 * Lanza error (throw) si el formato es inválido o tiene propiedades prohibidas.
 * @param {string} cursor 
 * @returns {Object|null}
 */
export function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const str = Buffer.from(cursor, 'base64url').toString('utf8');
    const obj = JSON.parse(str);
    
    // Strict validation
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      throw new Error('Cursor must be an object');
    }
    if (!('id' in obj) || !('createdAt' in obj)) {
      throw new Error('Cursor missing required properties');
    }
    if (typeof obj.id !== 'number' || obj.id <= 0 || !Number.isInteger(obj.id)) {
      throw new Error('Cursor id must be a positive integer');
    }
    if (typeof obj.createdAt !== 'string' || Number.isNaN(Date.parse(obj.createdAt))) {
      throw new Error('Cursor createdAt must be a valid date string');
    }
    
    // Ensure no extra properties
    const keys = Object.keys(obj);
    if (keys.length > 2) {
      throw new Error('Cursor contains unexpected properties');
    }
    
    return { id: obj.id, createdAt: obj.createdAt };
  } catch (err) {
    throw new Error('Invalid cursor');
  }
}
