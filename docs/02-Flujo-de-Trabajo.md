---
tags: [workflow, bait-prepago]
---

# Flujo de Trabajo de Desarrollo

Ver también: [[Home]] · [[01-Stack-Tecnico]] · [[03-Variables-de-Entorno]]

Este documento consolida, en un único flujo operativo, las instrucciones que ya existen repartidas entre `README.md` y `GEMINI.md` en la raíz del repo.

## 1. Preparación del entorno local

1. `npm install` — instala `@neondatabase/serverless` (runtime) y `playwright` + `vercel` (dev).
2. Crear un archivo `.env.local` (no commiteado, ver `.gitignore`) con al menos `DATABASE_URL` apuntando a una rama de Neon de desarrollo/preview — **nunca** a la rama de producción.
3. `vercel dev` — levanta el entorno serverless local en `http://localhost:3000`, sirviendo tanto los archivos estáticos (`index.html`, `admin/*.html`) como las funciones de `api/`.

## 2. Base de datos y migraciones

1. Crear/usar un proyecto Neon y vincularlo a Vercel mediante la integración oficial (esto inyecta `DATABASE_URL`/`POSTGRES_URL` automáticamente, sin que el desarrollador maneje el connection string a mano).
2. Antes de migrar, confirmar la zona horaria efectiva:
   ```sql
   SELECT current_setting('TimeZone');
   ```
   Debe devolver `America/Mexico_City`.
3. Ejecutar migraciones en orden con `npm run db:migrate` (aplica `db/migrate.js`, que primero corre un *gate* de timezone y aborta si no es CDMX).
4. Para el módulo de administración: `npm run db:migrate-admin` (`scripts/migrate-admin.js`), que aplica `db/migrations/002_admin_auth.sql` y siguientes.
5. Las migraciones SQL en `db/migrations/` son **idempotentes y aditivas** (usan `IF NOT EXISTS` / bloques `DO $$ ... $$` con verificación de existencia de constraints) — se pueden re-ejecutar sin duplicar objetos ni perder datos.
6. `scripts/verify-migration-idempotency.cjs` es la prueba formal de que correr una migración N veces produce el mismo estado que correrla una vez (`npm run test:migration-integration`).

## 3. Seguridad de entornos Preview vs. Producción (Fail-Closed)

- `scripts/preview-safety.js` se debe invocar en cualquier pipeline o script crítico antes de tocar la base de datos.
- Lógica de la puerta de seguridad:
  - Si `DATABASE_URL` contiene el identificador de la rama de producción prohibida → aborta (`process.exit(1)`).
  - Si `VERCEL_ENV === 'production'` → aborta (este script está pensado para *no* ejecutarse contra producción).
  - Si `VERCEL_ENV === 'preview'` → exige que `EXPECTED_NEON_ENDPOINT_ID` y `EXPECTED_NEON_BRANCH_ID` estén definidos y que coincidan con el `DATABASE_URL` real, o aborta.
  - Ante cualquier ambigüedad, **falla cerrado** en vez de continuar.
- `scripts/scrub-preview-data.js` limpia datos sensibles en ramas de preview para evitar fugas de PII fuera de producción.

## 4. Ciclo de una feature (recomendado)

1. Crear rama a partir de `main` (o de la rama de trabajo activa, p. ej. `prepago1.0`).
2. Si la feature toca esquema: agregar una migración nueva y numerada en `db/migrations/`, siguiendo el patrón idempotente de las existentes; actualizar `db/schema.sql` como fuente de verdad del esquema final.
3. Si la feature toca lógica compartida (validación, auth, RBAC, auditoría, atribución): **revisar primero [[04-Indice-de-Funciones]]** para no reimplementar un helper que ya existe en `lib/`.
4. Si la feature agrega un endpoint: replicar el patrón descrito en [[01-Stack-Tecnico]] §"Runtime de API" (cabeceras, método, same-origin, sesión, rol, *allowlist* de respuesta).
5. Si la feature toca fechas/horas: cubrir los 5 casos obligatorios de la política CDMX (ver `GEMINI.md` §5.5) — instante cercano a medianoche UTC, filtro de un solo día, límite exclusivo del día siguiente, render estable entre zonas horarias del runner, y verificación de `TimeZone` efectivo en la DB objetivo.
6. Actualizar/crear pruebas en `tests/` (unit primero, integración/E2E si toca DB o UI) y registrar el script nuevo en `package.json` si aplica.
7. Actualizar la nota de módulo correspondiente en `docs/modules/` y, si cambian las conexiones entre módulos, el diagrama en [[graph/architecture]].

## 5. Pruebas

Comandos disponibles (`package.json`):

| Comando | Qué cubre |
|---|---|
| `npm test` | Cadena completa: foundation → auth → dashboard unit → leads unit → workflow unit → analytics unit → resolución de entorno DB → política de timezone |
| `npm run test:foundation` | `tests/run.js` — sanity checks generales |
| `npm run test:auth` | `tests/admin-auth.js` — lógica de autenticación admin |
| `npm run test:dashboard-unit` / `test:dashboard-integration` | Overview del dashboard (unit sin DB / integración contra rama real vía `.env.branch`) |
| `npm run test:leads-unit` / `test:leads-integration` | Endpoint público de leads |
| `npm run test:workflow-unit` / `test:workflow-db-integration` / `test:workflow-http-integration` / `test:workflow-browser-e2e` | Máquina de estados de leads, en cuatro niveles (unit, DB, HTTP, navegador) |
| `npm run test:analytics-unit` | Métricas del módulo de analítica |
| `npm run test:db-env-resolution` | Resolución de `DATABASE_URL`/`POSTGRES_URL`/`STORAGE_DATABASE_URL` |
| `npm run test:timezone` | Los 5 casos obligatorios de política CDMX |
| `npm run test:migration-integration` | Idempotencia de migraciones |

Las pruebas de integración/E2E requieren `--env-file=.env.branch` (archivo local, no commiteado) con credenciales de una rama de Neon dedicada a pruebas.

## 6. Despliegue

1. `npm run deploy` (`vercel deploy`) — Vercel construye y publica; al ser sitio estático + funciones sin build step, el despliegue es directo.
2. Verificar tras el despliegue en *preview*:
   - Cabecera `X-Robots-Tag: noindex, nofollow` presente en el dominio de preview (`vercel.json`).
   - `scripts/preview-safety.js` no debe reportar conexión a la rama de producción.
3. Solo promover a producción cuando: migraciones aplicadas, pruebas de timezone en verde, y sin hallazgos abiertos de PII/NIP.
4. `_prod-auth-smoke.cjs` es un smoke test manual post-despliegue en producción: hace login, verifica cookies, prueba `/api/admin/overview`, confirma ausencia de PII en la respuesta, hace logout y valida el estado en DB. Se ejecuta a mano leyendo credenciales por `stdin` (nunca hardcodeadas).

## 7. Convenciones de commit y ramas observadas

- Mensajes de commit en español, formato `tipo: descripción breve` (`feat:`, `fix:`, `chore:`) — ver historial de `git log`.
- La rama de trabajo activa detectada en este repo es `prepago1.0`; `main` es la rama de referencia para PRs.

## 8. Checklist rápido antes de un PR

- [ ] ¿Toqué el esquema? → migración idempotente + `db/schema.sql` actualizado.
- [ ] ¿Toqué fechas/horas? → cubiertos los 5 casos CDMX.
- [ ] ¿Agregué un endpoint admin? → same-origin + sesión + rol + *allowlist* de respuesta + `Cache-Control: no-store`.
- [ ] ¿Reutilicé helpers de `lib/` en vez de duplicar lógica? → revisado [[04-Indice-de-Funciones]].
- [ ] ¿Agregué una dependencia nueva? → confirmado que no viola el stack cerrado (`GEMINI.md`).
- [ ] ¿Corre `npm test` en verde localmente?
- [ ] ¿Actualicé la nota de módulo y el grafo en `docs/` si cambiaron las conexiones?
