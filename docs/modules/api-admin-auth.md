---
tags: [modulo/api, bait-prepago]
---

# Módulo: Autenticación y sesión del panel admin

Ver también: [[Home]] · [[frontend-admin-panel]] · [[lib-compartida]] · [[base-de-datos]]

## Endpoints

| Endpoint | Archivo | Método |
|---|---|---|
| `/api/admin/login` | `api/admin/login.js` | `POST` |
| `/api/admin/logout` | `api/admin/logout.js` | `POST` |
| `/api/admin/session` | `api/admin/session.js` | `GET` |

## `login.js` — flujo detallado

1. Cabeceras `no-store` + `X-Robots-Tag: noindex, nofollow`.
2. Método `POST` + `Content-Type: application/json` obligatorios.
3. `assertSameOrigin(req)` — 403 si no coincide.
4. Normaliza email (`toLowerCase().trim()`).
5. Deriva `ipHash` y `accountHash` vía `hashIdentity()` (HMAC con `ADMIN_AUTH_PEPPER`) — **nunca** se guarda IP o email en claro en las tablas de rate limiting/auditoría.
6. Consulta `admin_login_attempts` por `kind IN ('IP','ACCOUNT')` con `locked_until > NOW()` → 429 si hay bloqueo activo.
7. Busca el usuario por email; verifica password con `verifyPassword()` si existe, o ejecuta el hash *dummy* (`DUMMY_PASSWORD_HASH`) si no existe — mismo costo computacional en ambos casos.
8. Si falla: registra/incrementa intento en `admin_login_attempts` (ventana de 15 min, bloqueo tras 5 intentos) para IP y cuenta, e inserta `LOGIN_FAILED` en `admin_audit_log` (inline, no vía `logAdminAction` porque esa acción no está en el `ACTION_METADATA_ALLOWLIST`).
9. Si tiene éxito: una sola sentencia SQL con CTEs (`WITH ...`) crea la sesión, borra los intentos fallidos y registra `LOGIN_SUCCESS`, todo en una sola *round-trip* (el driver serverless de Neon no soporta bien bloques `BEGIN/COMMIT` explícitos, de ahí el uso de CTEs para atomicidad).
10. Cookie de sesión: `serializeSessionCookie(sessionToken)` — `HttpOnly`, `SameSite=Strict`, `Secure` si `VERCEL_ENV` es `production`/`preview`, expira en 8 horas.

## `logout.js`

- `bodyParser: false` (no necesita leer body).
- `assertSameOrigin(req)` → 403 si falla.
- Borra la cookie **siempre**, incluso si no hay sesión válida.
- Si había sesión, `DELETE FROM admin_sessions ... RETURNING admin_user_id` y registra `LOGOUT` en auditoría.

## `session.js`

- Delegado 100% a `requireAdminSession(req, res)` (`lib/admin-session.js`) — no reimplementa validación.
- Responde `{ authenticated: true, user: { email, role } }` — nunca expone `id` de sesión ni hash de password.

## Modelo de datos asociado

- `admin_users` — email, `password_hash` (formato `scrypt$...`), `role`, `active`, `last_login_at`.
- `admin_sessions` — `token_hash` (SHA-256), `expires_at`, `last_seen_at`.
- `admin_login_attempts` — `key_hash` (HMAC), `kind` (`IP`/`ACCOUNT`), `attempts`, `window_started_at`, `locked_until`.
- `admin_audit_log` — `action`, `actor_hash` (HMAC), `metadata` (JSONB, allowlisted).

Ver [[base-de-datos]] para el DDL completo.

## Conexiones

- Consumido por [[frontend-admin-panel]] (todas las páginas hacen `session.js` al cargar; `login`/`logout` desde sus respectivas vistas).
- `requireAdminSession()` (definido aquí conceptualmente pero implementado en `lib/admin-session.js`) es usado por **todos** los demás endpoints de `api/admin/*` — ver [[lib-compartida]] y [[04-Indice-de-Funciones]].
