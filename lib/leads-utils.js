/**
 * lib/leads-utils.js
 * Helpers para formateo de PII y seguridad de Leads.
 */

/**
 * Enmascara un número de teléfono dejando solo los últimos 4 dígitos visibles.
 * Si el teléfono no tiene longitud suficiente, lo enmascara proporcionalmente.
 * @param {string} phone 
 * @returns {string}
 */
function maskPhone(phone) {
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
 * Sanitiza una URL para evitar inyección XSS o javascript: links.
 * @param {string} url 
 * @returns {string}
 */
function sanitizeAdminUrl(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '#invalid-protocol';
    }
    return parsed.toString();
  } catch (err) {
    // Si no es una URL válida, la devolvemos como texto si parece relativa,
    // o simplemente la limpiamos si es peligrosa
    const cleanStr = String(url).replace(/javascript:/gi, '').trim();
    return cleanStr;
  }
}

/**
 * Codifica un cursor (objeto JSON) en Base64url seguro.
 * @param {Object} obj 
 * @returns {string}
 */
function encodeCursor(obj) {
  if (!obj) return '';
  try {
    const str = JSON.stringify(obj);
    return Buffer.from(str).toString('base64url');
  } catch (err) {
    return '';
  }
}

/**
 * Decodifica un cursor Base64url en un objeto JSON.
 * @param {string} cursor 
 * @returns {Object|null}
 */
function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const str = Buffer.from(cursor, 'base64url').toString('utf8');
    return JSON.parse(str);
  } catch (err) {
    return null; // Bad cursor = null
  }
}

module.exports = {
  maskPhone,
  sanitizeAdminUrl,
  encodeCursor,
  decodeCursor
};
