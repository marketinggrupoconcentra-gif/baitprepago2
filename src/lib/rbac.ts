/**
 * src/lib/rbac.ts
 *
 * Matriz de permisos CENTRALIZADA para el Admin Console de BAIT Prepago.
 * TODA la autorización debe resolverse SERVER-SIDE usando esta matriz.
 * Los componentes de cliente solo usan esto para ocultar UI — la autorización
 * real ocurre en Server Components y Route Handlers.
 *
 * Roles disponibles:
 *   Administrador — Acceso completo, gestión de usuarios, configuración
 *   Editor        — Puede ver y editar leads, no gestión de usuarios/config
 *   Lector        — Solo lectura, sin export de datos sensibles
 */

export type AdminRole = 'Administrador' | 'Editor' | 'Lector';

export type Permission =
  // Dashboard
  | 'dashboard.view'
  // Leads
  | 'leads.view'
  | 'leads.detail.view'           // Ver PII descifrada (auditado)
  | 'leads.status.change'         // Cambiar commercial_status
  | 'leads.export'                // Export CSV (sin PII cifrada)
  | 'leads.export.sensitive'      // Export CSV con campos sensibles descifrados
  // Analytics
  | 'analytics.view'
  // Logs de entrega (delivery_outbox → Intelix)
  | 'logs.view'
  | 'logs.retry'                  // Re-encolar un envío fallido en el outbox
  // Usuarios admin
  | 'users.view'
  | 'users.invite'
  | 'users.role.change'
  | 'users.disable'
  // Configuración
  | 'settings.view'
  | 'settings.edit'
  // Reportes
  | 'reports.view'
  | 'reports.create'
  | 'reports.edit'
  | 'reports.disable'
  | 'reports.manual_run'
  // Audit logs
  | 'audit.view';

type PermissionsMap = Record<AdminRole, Set<Permission>>;

const ADMIN_PERMISSIONS: Permission[] = [
  'dashboard.view',
  'leads.view',
  'leads.detail.view',
  'leads.status.change',
  'leads.export',
  'leads.export.sensitive',
  'analytics.view',
  'logs.view',
  'logs.retry',
  'users.view',
  'users.invite',
  'users.role.change',
  'users.disable',
  'settings.view',
  'settings.edit',
  'reports.view',
  'reports.create',
  'reports.edit',
  'reports.disable',
  'reports.manual_run',
  'audit.view',
];

const EDITOR_PERMISSIONS: Permission[] = [
  'dashboard.view',
  'leads.view',
  'leads.detail.view',
  'leads.status.change',
  'leads.export',
  'analytics.view',
  'logs.view',
  'logs.retry',
  'reports.view',
  'reports.manual_run',
  'settings.view',
];

const READER_PERMISSIONS: Permission[] = [
  'dashboard.view',
  'leads.view',
  'analytics.view',
  'logs.view',
  'reports.view',
  'settings.view',
];

const PERMISSIONS_MAP: PermissionsMap = {
  Administrador: new Set(ADMIN_PERMISSIONS),
  Editor: new Set(EDITOR_PERMISSIONS),
  Lector: new Set(READER_PERMISSIONS),
};

/**
 * Verifica si un rol tiene un permiso específico.
 * Usar server-side en Route Handlers y Server Components.
 */
export function hasPermission(role: AdminRole, permission: Permission): boolean {
  return PERMISSIONS_MAP[role]?.has(permission) ?? false;
}

/**
 * Obtiene todos los permisos de un rol.
 */
export function getPermissions(role: AdminRole): Set<Permission> {
  return PERMISSIONS_MAP[role] ?? new Set();
}

/**
 * Valida que un rol sea un AdminRole válido.
 */
export function isValidAdminRole(role: unknown): role is AdminRole {
  return role === 'Administrador' || role === 'Editor' || role === 'Lector';
}
