---
tags: [funciones, indice, bait-prepago]
---

# Índice de Funciones por Módulo

Ver también: [[Home]] · [[modules/lib-compartida]] · [[graph/architecture]]

> [!TIP] Propósito de este documento
> Catálogo de **todas las funciones exportadas** de `lib/` (y las funciones internas relevantes de `api/`), para que antes de escribir un helper nuevo se compruebe si ya existe uno equivalente. Esto es lo que evita "emplamar" (duplicar/solapar) funciones entre módulos.

## `lib/db.js` — conexión a base de datos

| Función | Firma | Qué hace |
|---|---|---|
| `resolveDatabaseUrl(env)` | `(env) => string` | Resuelve el connection string probando `DATABASE_URL → POSTGRES_URL → STORAGE_DATABASE_URL`; lanza error si no hay ninguno. |
| `getDb()` | `() => sql` | Devuelve el cliente Neon singleton (`sqlInstance`), creándolo solo la primera vez por *cold start*. **Único punto de entrada a la DB** — cualquier módulo nuevo debe importar esto, no instanciar `neon()` por su cuenta. |

## `lib/admin-auth.js` — primitivas de seguridad de autenticación

| Función | Qué hace |
|---|---|
| `hashPassword(password)` | Genera un hash `scrypt` con salt aleatorio de 16 bytes, formato serializado `scrypt$N$r$p$salt$hash`. |
| `verifyPassword(password, hashString)` | Verifica un password contra un hash serializado, validando el perfil scrypt exacto (N/r/p) antes de derivar, y comparación en tiempo constante (`timingSafeEqual`). |
| `DUMMY_PASSWORD_HASH` | Hash scrypt precomputado (no secreto) usado para ejecutar una verificación "dummy" cuando el usuario no existe, evitando enumeración por temporización. |
| `generateSessionToken()` | 32 bytes aleatorios en hex — token opaco de sesión. |
| `hashSessionToken(token)` | SHA-256 del token — lo único que se persiste en `admin_sessions.token_hash`. |
| `hashIdentity(value)` | HMAC-SHA256 con `ADMIN_AUTH_PEPPER` — usado para pseudonimizar IP/email/sesión en auditoría (`actor_hash`, `key_hash`). |
| `serializeSessionCookie(token)` / `clearSessionCookie()` | Construyen el header `Set-Cookie` de la sesión admin (`HttpOnly`, `SameSite=Strict`, `Secure` condicional a `VERCEL_ENV`). |
| `parseCookies(req)` | Parser manual de la cabecera `Cookie` (sin dependencias externas). |
| `getClientIp(req)` | Extrae la IP real desde `x-forwarded-for`. |
| `sanitizeUserAgent(req)` | Trunca el `user-agent` a 255 caracteres. |
| `isVercelEnvironment()` | `true` si `VERCEL_ENV` está definido. |
| `assertSameOrigin(req)` | Verifica que el header `Origin` coincida con el host — mitigación CSRF ligera para mutaciones. Lanza si no coincide. |

## `lib/admin-session.js` — guardia de sesión centralizada

| Función | Qué hace |
|---|---|
| `requireAdminSession(req, res)` | **Único** punto para validar la cookie de sesión contra `admin_sessions`/`admin_users`: verifica existencia, expiración y usuario activo; limpia cookie y responde 401 si falla; refresca `last_seen_at` de forma no bloqueante. Devuelve `{ id, email, role, sessionId }` o `null`. Todo endpoint de `api/admin/*` (salvo `login`) debe usar esta función en vez de reimplementar la validación. |

## `lib/admin-rbac.js` — control de acceso por rol

| Función / constante | Qué hace |
|---|---|
| `ROLES` | Enum: `SUPER_ADMIN`, `ADMIN`, `VIEWER` (nota: el esquema de DB también admite `EDITOR`, usado en algunos endpoints de analítica/leads). |
| `hasRole(userRole, allowedRoles[])` | Verifica pertenencia del rol del usuario a la lista permitida. Único mecanismo de autorización por rol — no crear checks de rol ad-hoc en los handlers. |

## `lib/admin-audit.js` — auditoría de acciones administrativas

| Función | Qué hace |
|---|---|
| `logAdminAction(user, action, metadata, executor?)` | Inserta en `admin_audit_log`, validando que `action` esté en `ACTION_METADATA_ALLOWLIST` y que las claves de `metadata` estén explícitamente permitidas para esa acción (previene fuga accidental de PII en logs). Acepta un `executor` opcional para participar en una transacción/CTE existente. Falla cerrado: si la escritura de auditoría falla, lanza error (no se silencia). |

Acciones auditadas conocidas: `LOGIN_SUCCESS`, `LOGIN_FAILED` (registrada inline en `api/admin/login.js`, no vía este helper), `LOGOUT` (inline en `api/admin/logout.js`), `LEAD_PHONE_SEARCH`, `LEAD_PHONE_REVEAL`, `LEAD_STATUS_CHANGED`, `ANALYTICS_EXPORT`, `USER_CREATE`, `USER_UPDATE`, `PASSWORD_CHANGE`.

## `lib/attribution.js` — atribución de marketing

| Función | Qué hace |
|---|---|
| `parseAttribution(body, reqHeaders)` | Extrae y trunca (vía `truncate` de `validation.js`) UTMs de Google, parámetros de Meta Ads (`fbclid`, `fb_ad_id`, `fb_adset_id`, `fb_campaign_id`), `gclid`, e IP/user-agent/referrer/page_url del request. Único punto de captura de atribución — no duplicar este parseo en otros endpoints. |

## `lib/leads-utils.js` — utilidades de leads y PII

| Función | Qué hace |
|---|---|
| `maskPhone(phone)` | Enmascara todos los dígitos salvo los últimos 4. **Toda** vista de listado de leads debe usar esta función; solo `reveal-phone.js` (auditado, `SUPER_ADMIN`) devuelve el teléfono completo. |
| `sanitizeAdminUrl(url)` | Valida protocolo `http(s)`, elimina query/hash/credenciales embebidas — usado para mostrar `page_url`/`referrer` sin riesgo de XSS o fuga de credenciales en URL. |
| `encodeCursor(obj)` / `decodeCursor(cursor)` | Serializan/validan cursores de paginación en Base64url con validación estricta de forma (`{ id: number, createdAt: string }`, sin propiedades extra). Único mecanismo de paginación por cursor del proyecto. |

## `lib/security.js` — rate limiting e idempotencia (endpoint público)

| Función | Qué hace |
|---|---|
| `checkRateLimitAndIdempotency(sql, ip, phone)` | Bloquea si la misma IP creó >10 leads en la última hora, o si el mismo teléfono se envió en los últimos 15 minutos. Específico del endpoint público `api/leads.js` — el panel admin usa un mecanismo de rate limiting distinto (`admin_login_attempts`, ver `lib/admin-auth.js`/`admin-session.js`). |

## `lib/validation.js` — validación y sanitización de payload público

| Función | Qué hace |
|---|---|
| `truncate(str, max)` | Recorte defensivo de strings a una longitud máxima (default 255). Usado por `attribution.js` y disponible para cualquier campo nuevo de texto libre. |
| `validateLeadPayload(body)` | Valida formato de teléfono (10 dígitos) y NIP (4 dígitos, solo para bloquear spam) — **el NIP se valida pero jamás se incluye en el objeto `data` devuelto**, por lo que nunca llega a la capa de DB. |

## `lib/lead-workflow.js` — máquina de estados de leads (fuente única de verdad)

| Función / constante | Qué hace |
|---|---|
| `STATUS_CATALOG` | 12 estados válidos del ciclo de vida de un lead (`NEW` → ... → `COMPLETED`/`REJECTED`/`CANCELLED`), con etiqueta en español. |
| `REASON_CATALOG` | 9 motivos válidos, requeridos solo para estados terminales negativos. |
| `isValidStatus(status)` / `isValidReason(reason)` | Chequeos de pertenencia al catálogo. |
| `isReasonRequired(status)` | `true` para `REJECTED`/`CANCELLED`. |
| `validateTransitionPayload(status, reason)` | Valida coherencia estado/motivo antes de aplicar una transición. Usado por `api/admin/leads/status.js` — cualquier lugar que necesite validar un cambio de estado debe reusar esto, no reimplementar el catálogo. |

## Funciones internas notables en `api/` (no exportadas, específicas del handler)

| Función | Archivo | Qué hace |
|---|---|---|
| `neutralizeCsv(value)` | `api/admin/analytics/export.js` | Previene inyección de fórmulas CSV (prefijo `=`, `+`, `-`, `@`) y escapa comillas/comas/saltos de línea. Si se agrega un segundo endpoint de exportación CSV, esta función debería moverse a `lib/` en vez de duplicarse. |
| `parseDateOnly(value)` | `api/admin/leads/index.js` | Parseo estricto de fecha `YYYY-MM-DD` a epoch UTC del día civil, sin depender de `Date.parse` (evita ambigüedad de zona horaria). Candidato a mover a `lib/` si se repite en un tercer endpoint (ya se usa un patrón equivalente inline en `analytics.js` y `analytics/export.js`). |

## Duplicaciones conocidas a vigilar

- La lógica de parseo/validación de rango de fechas (`from`/`to`, límite de 366 días) está **inline y casi idéntica** en `api/admin/analytics.js`, `api/admin/analytics/export.js` y (con variante de calendario civil) `api/admin/leads/index.js`. Es la principal candidata a extraerse a un helper compartido en `lib/` (p. ej. `lib/date-range.js`) antes de agregar un cuarto endpoint con filtros de fecha.
- Los bloques de *facets* (`sources`, `mediums`, `campaigns`, `statuses`) están duplicados casi línea por línea entre `api/admin/leads/facets.js` y `api/admin/analytics/facets.js`. Si se necesita un tercer consumidor de facets, extraer a `lib/leads-facets.js`.
