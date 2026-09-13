import 'server-only';
import crypto from 'crypto';

export function hashClickId(provider: 'gclid' | 'fbclid', clickId: string): string {
  if (!clickId) return '';
  
  // Prefer specific secret, fallback to another secure existing key
  const rawKey = process.env.CLICK_ID_SECRET || process.env.PII_BLIND_INDEX_KEY;
  if (!rawKey || !/^[0-9a-fA-F]{64}$/.test(rawKey)) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[attribution] ERROR: Valid 64-char hex CLICK_ID_SECRET or PII_BLIND_INDEX_KEY required. Failing closed for click-ID hash.');
      return ''; // fail closed: omit hash entirely rather than use weak/fallback key
    }
    console.warn('[attribution] WARN: Using insecure development key for click IDs');
  }
  
  const secret = rawKey && /^[0-9a-fA-F]{64}$/.test(rawKey) 
    ? Buffer.from(rawKey, 'hex') 
    : Buffer.from('00'.repeat(32), 'hex');
    
  const input = `attribution-click:v1:${provider}:${clickId}`;
  return crypto.createHmac('sha256', secret).update(input, 'utf8').digest('hex');
}
