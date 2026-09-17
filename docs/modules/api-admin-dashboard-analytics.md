---
tags: [modulo/api, bait-prepago]
---

# Módulo: Dashboard (overview) y Analítica

Ver también: [[Home]] · [[frontend-admin-panel]] · [[lib-compartida]] · [[base-de-datos]] · [[../04-Indice-de-Funciones]]

## Endpoints

| Endpoint | Archivo | Roles permitidos | Notas |
|---|---|---|---|
| `GET /api/admin/overview` | `api/admin/overview.js` | Cualquier sesión válida (no filtra por rol explícitamente más allá de `requireAdminSession`) | `range` whitelisted a `7\|14\|30` días. |
| `GET /api/admin/analytics` | `api/admin/analytics.js` | `SUPER_ADMIN, ADMIN, EDITOR*, VIEWER` | Filtros `source/medium/campaign/status/from/to`. |
| `GET /api/admin/analytics/facets` | `api/admin/analytics/facets.js` | `SUPER_ADMIN, ADMIN, EDITOR*, VIEWER` | Opciones para poblar selects de filtro. |
| `GET /api/admin/analytics/export` | `api/admin/analytics/export.js` | `SUPER_ADMIN, ADMIN` | Exporta CSV, sin PII, con neutralización anti-fórmula. |

`*` `ROLES.EDITOR` no está definido en `lib/admin-rbac.js` — ver hallazgo en [[../00-Auditoria-Tecnica]] §5.2.

## `overview.js` — KPIs del dashboard principal

- Rango whitelisted: `ALLOWED_RANGES = {7,14,30}`, default 14.
- 5 queries en paralelo (`Promise.all`):
  1. **KPIs totales**: total, últimas 24h, últimos 7d (intervalos rodantes desde `NOW()`), tasa de atribución.
  2. **Tendencia diaria**: `generate_series` con *zero-fill* de días sin leads, límites de día civil calculados con `bounds.today` en `AT TIME ZONE 'America/Mexico_City'`.
  3. **Top fuentes** (top 5 + agregación "Otros").
  4. **Top campañas** (top 5).
  5. **Actividad reciente** (últimos 10, sin PII: solo `created_at`, `source`, `campaign`, `medium`).
- Todos los campos de respuesta son explícitamente listados (`kpis`, `trend`, `sources`, `campaigns`, `recentActivity`) — nunca passthrough de fila completa.

## `analytics.js` — métricas filtrables

- Construye `WHERE` dinámico parametrizado (`$1, $2, ...`) a partir de filtros opcionales — nunca concatena valores de usuario directo en el SQL.
- Rango de fechas: default últimos 30 días; tope de 366 días entre `from`/`to`.
- Devuelve: `totals` (leads/atribuidos/completados/terminales), `trend` (creados vs. completados por día), `funnel` (conteo por estado con porcentaje), `sources`, `campaigns`.

## `analytics/facets.js` y `leads/facets.js`

- **Prácticamente idénticos** (mismo query de sources/mediums/campaigns limitado a 100, mismo cruce con `STATUS_CATALOG` de `lib/lead-workflow.js`) — ver recomendación de extracción a `lib/leads-facets.js` en [[../04-Indice-de-Funciones]].

## `analytics/export.js`

- Mismas reglas de filtro/rango que `analytics.js`.
- Columnas exportadas: `id, created_at, status, status_reason, utm_source, utm_medium, utm_campaign` — **sin** `phone`, `ip`, `user_agent` (cumple regla "SIN PII" declarada en el propio encabezado del archivo).
- `neutralizeCsv()` previene inyección de fórmulas (Excel/Sheets) escapando valores que empiezan con `=`, `+`, `-`, `@`.
- Límite de seguridad: `LIMIT 50000` filas.
- Registra `ANALYTICS_EXPORT` en auditoría con `rangeFrom`, `rangeTo`, `recordCount` (vía `logAdminAction`).

## Conexiones

- Consumido por `admin/dashboard.js` y `admin/analytics.js` en [[frontend-admin-panel]].
- Depende de `lib/db.js`, `lib/admin-session.js`, `lib/admin-rbac.js`, `lib/lead-workflow.js` (solo `facets.js` y `analytics/facets.js`), `lib/admin-audit.js` (solo `export.js`) — ver [[lib-compartida]].
- Lee exclusivamente de la tabla `leads` — ver [[base-de-datos]].
