---
tags: [modulo/scripts, bait-prepago]
---

# Módulo: Scripts Operativos y QA (`scripts/`)

Ver también: [[Home]] · [[base-de-datos]] · [[../03-Variables-de-Entorno]] · [[../02-Flujo-de-Trabajo]]

Colección de scripts Node ejecutados manualmente (no forman parte del runtime de producción). Se agrupan por función:

## Migraciones y verificación de esquema

| Script | Rol |
|---|---|
| `migrate-admin.js` | Aplica las migraciones del módulo admin (`npm run db:migrate-admin`). |
| `migrate-admin-branch.js` / `migrate-admin-branch.cjs` | Variante para aplicar migraciones contra una rama específica de Neon (útil en preview/QA). |
| `migrate-lead-workflow.js` | Aplica específicamente la migración del workflow de leads. |
| `verify-migration-idempotency.cjs` | Prueba formal de que correr una migración repetidamente no altera el esquema/datos (`npm run test:migration-integration`). |
| `check-admin-tables.js`, `check-db.js`, `check-hash.js`, `check-locks.js`, `check-locks2.js`, `check-prod.js` | Scripts de verificación puntual de estado de esquema, hashes de password, locks de Postgres, y salud de la conexión de producción. |

## Seguridad de entornos

| Script | Rol |
|---|---|
| `preview-safety.js` | *Fail-closed gate* — ver detalle en [[../02-Flujo-de-Trabajo]] §3 y hallazgo en [[../00-Auditoria-Tecnica]] §5.4. |
| `scrub-preview-data.js` | Limpia/anonimiza datos en ramas de preview para que no acumulen PII fuera de producción. |
| `clear-locks.js` | Libera locks de Postgres colgados en una rama (uso de emergencia en QA). |

## Datos de prueba (QA)

| Script | Rol |
|---|---|
| `create-admin.js`, `create-admin-direct.js`, `create-admin-branch.cjs` | Crean un usuario `SUPER_ADMIN` inicial en distintos contextos (local, rama específica). |
| `seed-dashboard-qa.js`, `seed-leads-module-qa.js` | Insertan datos sintéticos de leads para poblar dashboard/leads en QA. |
| `cleanup-dashboard-qa.js`, `cleanup-qa.js` | Revierten/limpian los datos sembrados. |
| `_qa-check-db.js`, `_qa-list-users.js`, `_count-admin-rows.cjs` | Utilidades de inspección rápida (prefijo `_` indica "uso interno/no oficial"). |

## Pruebas manuales / smoke

| Script | Rol |
|---|---|
| `manual-test.js` | Prueba manual ad-hoc (ejecución directa durante desarrollo). |
| `recheck-login.js` | Re-verifica el flujo de login contra un entorno dado. |
| `prod-db-smoke.js` | Smoke test mínimo de conectividad a la base de datos de producción. |
| `test-lead-workflow-migration.cjs` | Prueba dirigida de la migración de workflow de leads. |

## Scripts en la raíz del repo (fuera de `scripts/` pero de la misma familia operativa)

| Archivo | Rol |
|---|---|
| `_prod-auth-smoke.cjs` | Smoke test end-to-end **contra producción**: login → verificación de cookies → `GET /api/admin/overview` → confirma ausencia de PII en la respuesta → logout → verifica estado en DB. Lee credenciales por `stdin`, nunca hardcodeadas. |
| `scratch-qa-admin.js` | Script puntual para crear un admin QA (`qa-admin@bait.invalid`) directamente vía `hashPassword` + `INSERT`. |

## Variables de entorno usadas en esta capa

`DATABASE_URL`, `PRODUCTION_DB_URL`, `NEON_API_KEY`, `EXPECTED_NEON_ENDPOINT_ID`, `EXPECTED_NEON_BRANCH_ID`, `VERCEL_ENV`, `VERCEL_AUTOMATION_BYPASS_SECRET`, `VERCEL_BYPASS_SECRET`, `VERCEL_PREVIEW_URL`/`PREVIEW_URL`, `QA_ADMIN_EMAIL`/`QA_ADMIN_PASSWORD`, `QA_VIEWER_EMAIL`/`QA_VIEWER_PASSWORD`, `ENV_FILE` — ver detalle en [[../03-Variables-de-Entorno]].

## Conexiones

- Todos dependen de `@neondatabase/serverless` y, en varios casos, de `lib/admin-auth.js` (`hashPassword`) — ver [[lib-compartida]].
- Operan sobre las mismas tablas que la API en runtime — ver [[base-de-datos]].
