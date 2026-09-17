---
tags: [modulo/api, bait-prepago]
---

# Módulo: Usuarios Admin y Settings

Ver también: [[Home]] · [[frontend-admin-panel]] · [[lib-compartida]] · [[base-de-datos]]

## Endpoints

| Endpoint | Método | Roles | Qué hace |
|---|---|---|---|
| `api/admin/users/index.js` | `GET /api/admin/users` | `SUPER_ADMIN, ADMIN` | Lista usuarios admin (sin `password_hash`). |
| `api/admin/users/create.js` | `POST /api/admin/users/create` | `SUPER_ADMIN` | Crea usuario admin nuevo. |
| `api/admin/users/update.js` | `POST /api/admin/users/update` | `SUPER_ADMIN` | Cambia `role`/`active` de un usuario existente. |
| `api/admin/settings/password.js` | `POST /api/admin/settings/password` | Cualquier sesión válida (autogestión) | Cambia la propia contraseña del usuario autenticado. |

## `users/create.js`

- Valida `email`, `role` (debe pertenecer a `ROLES`), `password` (mínimo 8 caracteres).
- Verifica unicidad de email antes de insertar (`409` si ya existe).
- `hashPassword()` (scrypt) antes de guardar.
- Auditoría: `USER_CREATE` con `{ targetEmail, assignedRole }`.

## `users/update.js`

- **Bloquea auto-modificación**: `if (id === user.id) return 403` — evita que un `SUPER_ADMIN` se quite accidentalmente sus propios permisos y quede bloqueado del sistema.
- Construye `UPDATE` dinámico solo con los campos provistos (`role` y/o `active`), siempre parametrizado.
- Si `active === false`: además de actualizar el usuario, **borra todas sus sesiones activas** (`DELETE FROM admin_sessions WHERE admin_user_id = $1`) — desactivar a un usuario lo desloguea de inmediato en todos sus dispositivos.
- Auditoría: `USER_UPDATE` con `{ targetId, targetEmail, updatedRole, updatedActive }`.

## `settings/password.js`

- Requiere `currentPassword` + `newPassword` (mínimo 8 caracteres); verifica la actual con `verifyPassword()` antes de aceptar el cambio.
- Tras actualizar el hash, **invalida todas las sesiones del propio usuario** (`DELETE FROM admin_sessions WHERE admin_user_id = $1`) y limpia la cookie actual — fuerza re-login inmediato, incluso en la sesión que hizo el cambio.
- Auditoría: `PASSWORD_CHANGE` con `{ userId }`.

## Conexiones

- Consumido por `admin/users.js` y `admin/settings.js` en [[frontend-admin-panel]].
- Depende de `lib/db.js`, `lib/admin-session.js`, `lib/admin-rbac.js`, `lib/admin-auth.js` (`hashPassword`, `verifyPassword`, `clearSessionCookie`), `lib/admin-audit.js`.
- Opera sobre `admin_users` y `admin_sessions` — ver [[base-de-datos]].
- **Hueco de pruebas**: no hay tests unitarios dedicados a este módulo — ver [[../00-Auditoria-Tecnica]] §6 y §7.
