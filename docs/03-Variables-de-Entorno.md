---
tags: [config, env, bait-prepago]
---

# Variables de Entorno

Ver también: [[Home]] · [[01-Stack-Tecnico]] · [[modules/lib-compartida]]

> [!WARNING] Política de este documento
> Aquí solo se listan **nombres** de variables de entorno y su propósito funcional. **Nunca** se registran valores, connection strings, tokens, contraseñas ni URLs reales. Los valores viven exclusivamente en el panel de Vercel (Environment Variables) o en archivos locales ignorados por git (`.env`, `.env.*`, `.dev.vars`, `.env.local`, `.env.branch`), listados en `.gitignore`.

## Inventario (extraído por `grep` de `process.env.*` en todo el código fuente)

| Variable | Usada en | Propósito |
|---|---|---|
| `DATABASE_URL` | `lib/db.js`, `db/migrate.js`, scripts de `scripts/`, `_prod-auth-smoke.cjs` | Connection string principal de Neon PostgreSQL (inyectada por la integración Vercel↔Neon). |
| `POSTGRES_URL` | `lib/db.js`, `db/migrate.js` | Alias/fallback histórico del connection string de Postgres. |
| `STORAGE_DATABASE_URL` | `lib/db.js` | Segundo fallback para el connection string (integraciones de storage de Vercel). |
| `ADMIN_AUTH_PEPPER` | `lib/admin-auth.js` (`hashIdentity`) | Secreto (*pepper*) usado en HMAC-SHA256 para derivar hashes de identidad (IP, email, sesión) que se guardan en auditoría — nunca se guarda el dato crudo. |
| `VERCEL_ENV` | `lib/admin-auth.js`, `scripts/preview-safety.js` | Indica `production` / `preview` / `development`; controla el flag `Secure` de la cookie de sesión y las reglas de *fail-closed*. |
| `EXPECTED_NEON_ENDPOINT_ID` | `scripts/preview-safety.js` | Identificador esperado del endpoint de Neon en entorno preview, para certificar que no apunta a producción. |
| `EXPECTED_NEON_BRANCH_ID` | `scripts/preview-safety.js` | Identificador esperado de la rama de Neon en entorno preview, con la misma finalidad. |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | scripts de QA/CI | Header de bypass de protección de despliegue de Vercel para automatizar pruebas contra un preview protegido. |
| `VERCEL_BYPASS_SECRET` | scripts de QA/CI | Variante/alias del secreto de bypass anterior. |
| `VERCEL_PREVIEW_URL` / `PREVIEW_URL` | scripts de QA (`tests/*-e2e.js`, `scripts/*`) | Dominio del deployment de preview contra el que corren pruebas E2E/manuales. |
| `PRODUCTION_DB_URL` | scripts de verificación manual (`scripts/check-prod.js` y similares) | Connection string explícito de producción, usado solo en scripts de verificación puntual (no en runtime de la app). |
| `NEON_API_KEY` | scripts administrativos (creación/migración de ramas de Neon) | Credencial de la API de gestión de Neon (fuera del runtime de la aplicación). |
| `QA_ADMIN_EMAIL` / `QA_ADMIN_PASSWORD` | scripts/tests de QA | Credenciales de una cuenta admin sintética usada solo en entornos de prueba. |
| `QA_VIEWER_EMAIL` / `QA_VIEWER_PASSWORD` | scripts/tests de QA | Credenciales de una cuenta con rol `VIEWER` sintética, para probar RBAC de solo lectura. |
| `ENV_FILE` | scripts de carga de entorno | Ruta alternativa a un archivo de variables de entorno a cargar en scripts locales. |

## Reglas de resolución

- `lib/db.js::resolveDatabaseUrl(env)` prueba en orden `DATABASE_URL → POSTGRES_URL → STORAGE_DATABASE_URL` y lanza error explícito si ninguna está definida — nunca falla en silencio ni usa un valor por defecto inseguro.
- `db/migrate.js` carga manualmente `.env.local` (si existe) solo para desarrollo local fuera de Vercel; en Vercel las variables llegan inyectadas por la plataforma.
- Todas las variables sensibles (`ADMIN_AUTH_PEPPER`, `*_DB_URL`, `*_API_KEY`, `*_SECRET`, `QA_*_PASSWORD`) deben configurarse **únicamente** en: (a) el panel de Environment Variables de Vercel, o (b) archivos locales cubiertos por `.gitignore` (`.env`, `.env.*`, `.dev.vars*`, `/payload.json`). Nunca deben aparecer en código fuente, commits, ni en este vault.

## Dónde se define cada alcance (Production / Preview / Development)

Vercel permite asignar valores distintos por entorno para la misma variable. La convención observada en el código:

- `DATABASE_URL` en **Production** apunta a la rama de producción de Neon; en **Preview/Development** debe apuntar siempre a una rama distinta — esto es lo que `scripts/preview-safety.js` verifica en tiempo de ejecución.
- `ADMIN_AUTH_PEPPER` puede (y por seguridad debería) diferir entre producción y preview, para que los hashes de auditoría no sean comparables entre entornos.

Para el detalle de qué helper usa cada variable, ver [[modules/lib-compartida]] y [[04-Indice-de-Funciones]].
