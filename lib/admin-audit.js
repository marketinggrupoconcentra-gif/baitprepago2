/**
 * lib/admin-audit.js
 * Helpers for logging administrative actions in the admin_audit_log table.
 */

import { getDb } from './db.js';
import { hashIdentity } from './admin-auth.js';

const ACTION_METADATA_ALLOWLIST = {
  LEAD_PHONE_SEARCH: ['resultCount'],
  LEAD_PHONE_REVEAL: ['leadId'],
  LOGIN_SUCCESS: [],
  LOGOUT: [],
  LEAD_STATUS_CHANGED: ['leadId', 'fromStatus', 'toStatus', 'reasonCode', 'fromVersion', 'toVersion'],
  ANALYTICS_EXPORT: ['rangeFrom', 'rangeTo', 'recordCount']
};

/**
 * Registers an administrative action.
 * @param {object} user - The authenticated admin user { id, sessionId }
 * @param {string} action - The predefined action code
 * @param {object} metadata - The JSON metadata to store.
 * @param {function} [executor] - Optional query executor (for transactions).
 * @returns {Promise<boolean>} - True if successful, throws otherwise.
 */
export async function logAdminAction(user, action, metadata = {}, executor = null) {
  const allowedKeys = ACTION_METADATA_ALLOWLIST[action];
  if (!allowedKeys) {
    throw new Error(`Audit action not allowed: ${action}`);
  }

  // Enforce PII policy: allowlist explicitly per action
  for (const key of Object.keys(metadata)) {
    if (!allowedKeys.includes(key)) {
      throw new Error(`Audit metadata key not allowed for ${action}: ${key}`);
    }
  }

  const sql = executor || getDb();
  const actorHash = hashIdentity(`session:${user.sessionId}`);

  try {
    const query = `
      INSERT INTO admin_audit_log (admin_user_id, action, actor_hash, metadata)
      VALUES ($1, $2, $3, $4)
    `;
    const params = [user.id, action, actorHash, JSON.stringify(metadata)];
    
    await sql.query(query, params);
    
    return true;
  } catch (err) {
    console.error('ADMIN_AUDIT_WRITE_FAILED');
    throw new Error('Audit logging failed. Secure fail-closed.');
  }
}
