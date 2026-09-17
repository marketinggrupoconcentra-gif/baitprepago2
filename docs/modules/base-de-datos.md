---
tags: [modulo/db, bait-prepago]
---

# Módulo: Base de Datos (Neon PostgreSQL)

Ver también: [[Home]] · [[lib-compartida]] · [[../03-Variables-de-Entorno]] · [[../02-Flujo-de-Trabajo]]

## Archivos

| Archivo | Rol |
|---|---|
| `db/schema.sql` | Fuente de verdad del esquema **final** de la tabla `leads` (incluye ya las columnas de workflow). Se ejecuta manualmente o sirve de referencia; las migraciones en `db/migrations/` son el mecanismo real de evolución incremental. |
| `db/migrate.js` | Script ejecutado por `npm run db:migrate`. Valida timezone (`assertBusinessTimeZone`), crea la tabla `leads` base, purga la columna `nip` si existe (migración incremental de PII), y crea los índices base. Carga `.env.local` manualmente para desarrollo fuera de Vercel. |
| `db/migrations/002_admin_auth.sql` | Crea `admin_users`, `admin_sessions`, `admin_login_attempts`, `admin_audit_log`. Idempotente (`CREATE TABLE IF NOT EXISTS`). |
| `db/migrations/003_lead_workflow.sql` | Añade columnas `status`, `status_reason`, `status_updated_at`, `status_version` a `leads`, con constraints agregados idempotentemente vía bloques `DO $$ ... $$` que verifican existencia en `pg_constraint` antes de crear. |
| `db/migrations/004_cdmx_timezone_policy.sql` | Fija `TimeZone = 'America/Mexico_City'` a nivel de base de datos y de rol; incluye un *guardrail* que aborta si existe alguna columna `timestamp without time zone` en el esquema público, y una postcondición que aborta si la timezone efectiva de la sesión no es la esperada. |

## Tablas

| Tabla | Columnas clave | Propósito |
|---|---|---|
| `leads` | `id, phone, utm_*, fbclid, fb_*, ip, user_agent, referrer, page_url, status, status_reason, status_updated_at, status_version` | Registro de cada lead capturado por la landing pública. Sin columna `nip` (purgada explícitamente). `status` restringido por `CHECK` a 12 valores; `status_reason` restringido a 9 valores y solo permitido junto a `REJECTED`/`CANCELLED`. |
| `admin_users` | `id, email, password_hash, role, active, created_at, updated_at, last_login_at` | Cuentas del panel admin. `role` restringido por `CHECK` a `SUPER_ADMIN, ADMIN, EDITOR, VIEWER`. |
| `admin_sessions` | `id, admin_user_id, token_hash, created_at, last_seen_at, expires_at` | Sesiones activas; `token_hash` es SHA-256 del token opaco (nunca el token en claro). |
| `admin_login_attempts` | `id, key_hash, kind, attempts, window_started_at, last_attempt_at, locked_until` | Rate limiting de login por IP y por cuenta (`key_hash` = HMAC). |
| `admin_audit_log` | `id, admin_user_id, action, actor_hash, metadata (JSONB), created_at` | Auditoría de acciones administrativas sensibles; `metadata` restringida por *allowlist* en `lib/admin-audit.js`. |

## Índices relevantes

- `leads_created_at_idx`, `leads_phone_idx`, `leads_ip_idx`, `leads_utm_source_idx`, `leads_utm_campaign_idx`, `leads_fbclid_idx`, `leads_status_created_at_idx (status, created_at DESC, id DESC)` — este último soporta directamente la paginación por cursor de `api/admin/leads/index.js`.
- `admin_sessions_admin_user_id_idx`, `admin_sessions_expires_at_idx`.
- `admin_login_attempts_kind_key_hash_idx`, `admin_login_attempts_locked_until_idx` (parcial, `WHERE locked_until IS NOT NULL`).
- `admin_audit_log_admin_user_id_idx`, `admin_audit_log_created_at_idx`.

## Política temporal (resumen operativo)

- Todo instante de negocio es `TIMESTAMPTZ`. Nunca se reescribe un timestamp histórico para "convertirlo" a hora local.
- Toda agrupación por día civil usa `columna AT TIME ZONE 'America/Mexico_City'` explícito en la consulta (ver `api/admin/overview.js`, `api/admin/analytics.js`).
- Límite superior de un rango de fecha = inicio exclusivo del día siguiente, nunca `23:59:59.999`.
- Ver los 5 casos de prueba obligatorios en [[../02-Flujo-de-Trabajo]] §4 y en `GEMINI.md` §5.5.

## Configuración de conexión

- `.neon` (raíz del repo) — metadatos de vínculo del proyecto Neon con Vercel (organización/proyecto/rama). No se reproduce su contenido en este vault.
- `neon.ts` (raíz del repo) — configuración declarativa del toolkit Neon: `auth: true`, función de preview de ejemplo (`hello.ts`), política de expiración de ramas nuevas (`ttl: "7d"`) para controlar costo de ramas efímeras de preview.
- Variables de entorno de conexión: ver [[../03-Variables-de-Entorno]].

## Conexiones

- Escrito por: [[api-publico-leads]] (tabla `leads`).
- Leído/escrito por: [[api-admin-auth]], [[api-admin-dashboard-analytics]], [[api-admin-leads]], [[api-admin-usuarios]] (todas las tablas `admin_*` y `leads`).
- Migrado por: `npm run db:migrate` / `npm run db:migrate-admin` — ver [[../02-Flujo-de-Trabajo]] y [[scripts-operacion]].
