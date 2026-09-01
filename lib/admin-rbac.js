/**
 * lib/admin-rbac.js
 * Helpers for Role-Based Access Control in the Admin Module.
 */

const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  VIEWER: 'VIEWER'
};

/**
 * Checks if a given role is authorized against an array of allowed roles.
 * @param {string} userRole - The role of the user (e.g. 'VIEWER', 'SUPER_ADMIN')
 * @param {string[]} allowedRoles - Roles allowed to access the resource.
 * @returns {boolean}
 */
function hasRole(userRole, allowedRoles = []) {
  if (!userRole) return false;
  if (!allowedRoles || allowedRoles.length === 0) return false;
  
  return allowedRoles.includes(userRole);
}

module.exports = {
  ROLES,
  hasRole
};
