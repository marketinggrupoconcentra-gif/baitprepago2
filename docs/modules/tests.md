---
tags: [modulo/tests, bait-prepago]
---

# Módulo: Pruebas (`tests/`)

Ver también: [[Home]] · [[../02-Flujo-de-Trabajo]] · [[../00-Auditoria-Tecnica]]

## Inventario por capa

| Capa | Archivos | Comando |
|---|---|---|
| Fundamentos | `run.js` | `npm run test:foundation` |
| Auth (unit) | `admin-auth.js` | `npm run test:auth` |
| Auth (integración) | `admin-auth-integration.js` | (manual, requiere `.env.branch`) |
| Auth (E2E navegador, Playwright) | `admin-e2e.js` | (manual) |
| Dashboard (unit) | `dashboard-unit.js` | `npm run test:dashboard-unit` |
| Dashboard (integración) | `dashboard-integration.js` | `npm run test:dashboard-integration` |
| Dashboard (E2E) | `dashboard-e2e.js` | (manual) |
| Leads público (unit) | `leads-unit.js` | `npm run test:leads-unit` |
| Leads público (integración) | `leads-integration.js` | `npm run test:leads-integration` |
| Leads público (E2E) | `leads-e2e.js` | (manual) |
| Workflow de leads (unit) | `workflow-unit.js` | `npm run test:workflow-unit` |
| Workflow (DB integración) | `workflow-db-integration.cjs` | `npm run test:workflow-db-integration` |
| Workflow (HTTP integración) | `workflow-http-integration.js` | `npm run test:workflow-http-integration` |
| Workflow (E2E navegador) | `workflow-browser-e2e.js` | `npm run test:workflow-browser-e2e` |
| Analítica (unit) | `analytics-unit.js` | `npm run test:analytics-unit` |
| Resolución de entorno DB | `db-env-resolution.test.js` (Node test runner) | `npm run test:db-env-resolution` |
| Política de timezone | `timezone-policy.test.js` (Node test runner) | `npm run test:timezone` |

## Orden de la suite `npm test`

```
foundation → auth → dashboard-unit → leads-unit → workflow-unit → analytics-unit → db-env-resolution → timezone
```

Nótese que **solo se ejecutan las pruebas unitarias** en `npm test`; las de integración/E2E requieren una rama de Neon de prueba (`--env-file=.env.branch`) y se corren manualmente o en un pipeline aparte.

## Huecos de cobertura detectados

- Sin pruebas dedicadas para `api/admin/users/*` (creación/actualización de usuarios admin).
- Sin pruebas dedicadas para `api/admin/settings/password.js`.
- Sin pruebas dedicadas para `api/admin/analytics/export.js` (exportación CSV) más allá de lo que pueda cubrir indirectamente `admin-e2e.js`.

Ver recomendaciones en [[../00-Auditoria-Tecnica]] §7.

## Conexiones

- Ejercitan directamente los módulos documentados en [[api-admin-auth]], [[api-admin-dashboard-analytics]], [[api-publico-leads]], [[api-admin-leads]] y [[base-de-datos]] (vía `db-env-resolution` y `timezone-policy`).
