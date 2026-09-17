---
tags: [modulo/api, bait-prepago]
---

# Módulo: Gestión de Leads (panel admin)

Ver también: [[Home]] · [[frontend-admin-panel]] · [[lib-compartida]] · [[base-de-datos]] · [[../04-Indice-de-Funciones]]

## Endpoints

| Endpoint | Método | Roles | Rol de negocio |
|---|---|---|---|
| `api/admin/leads/index.js` | `GET /api/admin/leads` | `SUPER_ADMIN, ADMIN, EDITOR*, VIEWER` | Listado paginado por cursor, teléfono enmascarado. |
| `api/admin/leads/detail.js` | `GET /api/admin/leads/detail?id=` | `SUPER_ADMIN, ADMIN, EDITOR*, VIEWER` | Detalle completo de un lead (teléfono enmascarado). |
| `api/admin/leads/facets.js` | `GET /api/admin/leads/facets` | `SUPER_ADMIN, ADMIN, EDITOR*, VIEWER` | Opciones de filtro. |
| `api/admin/leads/search.js` | `POST /api/admin/leads/search` | `SUPER_ADMIN` | Búsqueda exacta por teléfono completo (10 dígitos). |
| `api/admin/leads/reveal-phone.js` | `POST /api/admin/leads/reveal-phone` | `SUPER_ADMIN` | Revela el teléfono real de un lead por 60s (declarado en la respuesta, no aplicado server-side). |
| `api/admin/leads/status.js` | `PATCH /api/admin/leads/status` | `SUPER_ADMIN` | Cambia estado/motivo con control de concurrencia optimista. |
| `api/admin/leads/workflow.js` | `GET /api/admin/leads/workflow` | Cualquier sesión válida | Catálogo de estados/motivos + `canManageStatus` (derivado del rol). |

`*` Ver nota sobre `ROLES.EDITOR` en [[../00-Auditoria-Tecnica]] §5.2.

## `index.js` — listado paginado

- Paginación por **cursor** (`(created_at, id)` tupla estable, orden `DESC, DESC`) vía `encodeCursor`/`decodeCursor` de `lib/leads-utils.js` — no usa `OFFSET`.
- `limit` whitelisted a `25 | 50 | 100`.
- Filtros: `source, medium, campaign, status, from, to` — fechas de calendario `YYYY-MM-DD` validadas con `parseDateOnly()` (función local, ver [[../04-Indice-de-Funciones]]) e interpretadas en `America/Mexico_City`; el límite superior es el **inicio exclusivo del día siguiente**, nunca `23:59:59.999`.
- Respuesta: `items[]` con `phoneMasked` (nunca el teléfono real), más `pagination.{limit,nextCursor,hasMore,total}`.

## `status.js` — máquina de estados con concurrencia optimista

- Requiere rol exacto `SUPER_ADMIN` (no usa `hasRole` con lista, sino comparación directa `user.role !== 'SUPER_ADMIN'`).
- Valida el payload con `validateTransitionPayload()` de `lib/lead-workflow.js` (coherencia estado/motivo).
- **Una sola sentencia SQL con CTEs** hace: leer estado actual → `UPDATE ... WHERE status_version = expectedVersion AND (status IS DISTINCT FROM ... OR reason IS DISTINCT FROM ...)` → insertar auditoría `LEAD_STATUS_CHANGED` con `fromStatus/toStatus/fromVersion/toVersion` — todo atómico sin `BEGIN/COMMIT` explícito (limitación del driver serverless de Neon).
- Maneja 3 desenlaces: `404` (lead no existe), `409` (conflicto de versión — otra escritura ganó la carrera), `200` con `changed: true|false` (éxito o *no-op* real).

## `reveal-phone.js` / `search.js` — acceso a PII cruda

- Ambos exigen `SUPER_ADMIN`, `assertSameOrigin`, límite de tamaño de payload (2KB), y `Content-Type: application/json`.
- Ambos llaman a `logAdminAction()` **antes** de devolver el dato sensible — si la auditoría falla, la respuesta falla también (fail-closed, PII nunca se entrega sin dejar rastro).
- `search.js` solo acepta teléfono exacto de 10 dígitos (sin búsqueda parcial/LIKE, evitando *scraping* de la base).

## Conexiones

- Consumido por `assets/admin-leads.js` en [[frontend-admin-panel]].
- Depende de `lib/db.js`, `lib/admin-session.js`, `lib/admin-rbac.js`, `lib/leads-utils.js`, `lib/admin-audit.js`, `lib/admin-auth.js` (`assertSameOrigin`, `hashIdentity`), `lib/lead-workflow.js` — ver [[lib-compartida]].
- Opera sobre la tabla `leads` (columnas `status*`) y escribe en `admin_audit_log` — ver [[base-de-datos]].
