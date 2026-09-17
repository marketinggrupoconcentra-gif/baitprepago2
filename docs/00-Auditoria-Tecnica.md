---
tags: [auditoria, bait-prepago]
---

# Auditoría Técnica — BAIT Prepago 2

Fecha de auditoría: 2026-09-17 · Rama auditada: `prepago1.0` · Ver también: [[Home]] · [[01-Stack-Tecnico]] · [[04-Indice-de-Funciones]]

## 1. Alcance y metodología

Se revisó el 100% de los archivos de configuración y código fuente del repositorio (excluyendo `node_modules/`), clasificándolos por módulo funcional. Por cada módulo se documentó: (a) dónde vive su configuración, (b) qué elementos/funciones expone, (c) con qué otros módulos se conecta. **No se registró ningún valor de contraseña, token, connection string o URL de infraestructura** — solo nombres de variables y referencias de archivo/línea.

## 2. Inventario de módulos

| # | Módulo | Carpeta(s) | Nota detallada |
|---|---|---|---|
| 1 | Landing pública | `index.html`, `assets/`, `gracias/`, `walmart-beneficios/` | [[modules/frontend-landing]] |
| 2 | Panel administrativo (frontend) | `admin/*.html`, `admin/*.js`, `admin/*.css` | [[modules/frontend-admin-panel]] |
| 3 | API pública de leads | `api/leads.js` | [[modules/api-publico-leads]] |
| 4 | API de autenticación admin | `api/admin/login.js`, `logout.js`, `session.js` | [[modules/api-admin-auth]] |
| 5 | API de dashboard/analítica | `api/admin/overview.js`, `api/admin/analytics.js`, `api/admin/analytics/*` | [[modules/api-admin-dashboard-analytics]] |
| 6 | API de gestión de leads (admin) | `api/admin/leads/*` | [[modules/api-admin-leads]] |
| 7 | API de usuarios y settings (admin) | `api/admin/users/*`, `api/admin/settings/password.js` | [[modules/api-admin-usuarios]] |
| 8 | Librerías compartidas | `lib/*.js` | [[modules/lib-compartida]] |
| 9 | Base de datos | `db/schema.sql`, `db/migrations/*.sql`, `db/migrate.js`, `.neon`, `neon.ts` | [[modules/base-de-datos]] |
| 10 | Scripts operativos/QA | `scripts/*` | [[modules/scripts-operacion]] |
| 11 | Pruebas | `tests/*` | [[modules/tests]] |
| 12 | Configuración de plataforma | `vercel.json`, `package.json`, `.vercel/project.json`, `robots.txt`, `sitemap.xml` | Ver §3 abajo |

Total de archivos de código/configuración auditados (excluyendo `node_modules`): 91 (incluye 18 endpoints de API, 10 módulos de `lib/`, 5 archivos SQL, 30 scripts, 18 archivos de test, 11 páginas/HTML, 8 JS de admin, `.obsidian` del propio vault).

## 3. Configuración de plataforma (raíz del repositorio)

| Archivo | Rol |
|---|---|
| `package.json` | Nombre del paquete, dependencia única de producción (`@neondatabase/serverless`), dependencias de desarrollo (`playwright`, `vercel`), y 18 scripts `npm run test:*` + `deploy`/`db:migrate*`. |
| `vercel.json` | Cabeceras de seguridad por ruta, CSP estricta en `/admin`, `no-store` en `/api` y `/admin`, cache inmutable en `/assets`, `noindex` condicional en el dominio de preview. |
| `.vercel/project.json` | Vínculo local proyecto↔Vercel (gitignored). No se documenta su contenido. |
| `.neon` | Metadatos de vínculo del proyecto Neon (organización/proyecto/rama). No contiene credenciales; no se reproduce su contenido literal en este vault por prudencia. |
| `neon.ts` | Configuración declarativa del toolkit Neon: política de expiración de ramas de preview (7 días) y una función de ejemplo (`hello.ts`). |
| `robots.txt` / `sitemap.xml` | SEO del sitio público — permiten indexación de `/` y `/walmart-beneficios/`; el panel `/admin` está excluido de indexación vía cabecera `X-Robots-Tag`, no vía `robots.txt`. |
| `.gitignore` | Excluye `.env*`, `.dev.vars*`, `.vercel`, `node_modules/`, `.DS_Store`, `/payload.json` — correcto para no commitear secretos. |

## 4. Hallazgos de seguridad y buenas prácticas (confirmados en código)

Aspectos ya bien resueltos, verificados por lectura directa del código:

- ✅ **NIP nunca persistido**: `lib/validation.js::validateLeadPayload` valida el NIP pero lo excluye deliberadamente del objeto `data` devuelto; el esquema (`db/schema.sql`) no tiene columna `nip`.
- ✅ **Teléfonos enmascarados por defecto**: todas las vistas de listado (`api/admin/leads/index.js`, `search.js`) usan `maskPhone()`; solo `reveal-phone.js` expone el número completo, restringido a `SUPER_ADMIN` y auditado obligatoriamente antes de responder.
- ✅ **Passwords con scrypt + verificación en tiempo constante**: `lib/admin-auth.js` valida el perfil scrypt exacto (N=32768, r=8, p=3) antes de derivar, y usa `crypto.timingSafeEqual`.
- ✅ **Mitigación de enumeración de usuarios**: `api/admin/login.js` ejecuta siempre exactamente una operación scrypt (real o `DUMMY_PASSWORD_HASH`), independientemente de si el usuario existe.
- ✅ **Rate limiting de login por IP y por cuenta**, con ventana deslizante y bloqueo de 15 minutos tras 5 intentos (`admin_login_attempts`).
- ✅ **CSRF ligero vía same-origin**: `assertSameOrigin()` se aplica en login, logout, reveal-phone, search y status.
- ✅ **Auditoría con *allowlist* de metadata por acción** (`admin-audit.js`), evitando fuga accidental de PII en logs (p. ej. nunca se audita el teléfono en texto plano, solo `leadId`).
- ✅ **Identidades pseudonimizadas en auditoría**: IP/email/sesión se guardan como HMAC (`hashIdentity` con `ADMIN_AUTH_PEPPER`), nunca en claro.
- ✅ **Concurrencia optimista (CAS) en cambios de estado de lead**: `api/admin/leads/status.js` usa `status_version` con `WHERE ... AND status_version = expectedVersion`, devolviendo 409 en conflicto — evita *lost updates*.
- ✅ **Anti-inyección de fórmulas CSV** en `analytics/export.js` (`neutralizeCsv`).
- ✅ **Política CDMX aplicada de extremo a extremo**: DB (`ALTER DATABASE ... SET TimeZone`), backend (`AT TIME ZONE 'America/Mexico_City'` explícito en cada query de agregación), frontend (`Intl.DateTimeFormat` con `timeZone` explícito en `admin/dashboard.js`, `analytics.js`, `users.js`).
- ✅ **Fail-closed en scripts de entorno**: `scripts/preview-safety.js` aborta ante cualquier ambigüedad; la migración `004` aborta si detecta columnas `timestamp without time zone` o timezone efectiva incorrecta.
- ✅ **Sin dependencias de frontend**: el panel admin no usa `localStorage`/`sessionStorage`/librerías externas, coherente con la CSP `script-src 'self'` de `vercel.json`.

## 5. Riesgos / puntos de atención (no bloqueantes, para seguimiento)

1. **Duplicación de lógica de rango de fechas y de facets** entre `api/admin/analytics.js`, `api/admin/analytics/export.js`, `api/admin/leads/index.js` y los dos endpoints `facets.js` — ver detalle y recomendación en [[04-Indice-de-Funciones]] §"Duplicaciones conocidas a vigilar". Riesgo: si se corrige un bug de fecha en un endpoint, es fácil olvidar replicarlo en los otros tres.
2. **RBAC con rol `EDITOR` referenciado pero no definido en `lib/admin-rbac.js`**: `api/admin/analytics.js`, `analytics/facets.js` y `leads/index.js`, `leads/facets.js` llaman a `hasRole(user.role, [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.EDITOR, ROLES.VIEWER])`, pero `ROLES` en `lib/admin-rbac.js` solo define `SUPER_ADMIN`, `ADMIN`, `VIEWER`. `ROLES.EDITOR` se evalúa como `undefined`, y `hasRole` lo filtra correctamente (un usuario con rol `undefined` nunca hace match), por lo que **no es una vulnerabilidad** — pero si en el futuro se crea un usuario con rol `'EDITOR'` en la tabla `admin_users` (el `CHECK` de la migración 002 sí lo permite), quedaría con acceso denegado a estos endpoints de forma inconsistente con la intención original. Recomendación: agregar `EDITOR` a `ROLES` en `lib/admin-rbac.js` para que el enum de código coincida con el `CHECK` de base de datos.
3. **Archivos de utilidad en la raíz sin carpeta propia** (`_prod-auth-smoke.cjs`, `scratch-qa-admin.js`, `hello.ts`, `neon.ts`): son scripts legítimos (smoke test de producción, script QA puntual, función de ejemplo del toolkit Neon), pero al vivir sueltos en la raíz son menos descubribles. Documentados en [[modules/scripts-operacion]] para que no se pierdan de vista.
4. **`scripts/preview-safety.js` contiene un identificador de rama de Neon hardcodeado** como constante de "rama de producción prohibida". Es una decisión de diseño defendible (fail-closed explícito), pero acopla el script a un valor de infraestructura que debe mantenerse sincronizado manualmente si la rama de producción cambiara de ID alguna vez.

## 6. Cobertura de pruebas por módulo

| Módulo | Unit | Integración/DB | HTTP | E2E navegador |
|---|---|---|---|---|
| Auth admin | ✅ `admin-auth.js` | ✅ `admin-auth-integration.js` | — | ✅ `admin-e2e.js` |
| Dashboard/overview | ✅ `dashboard-unit.js` | ✅ `dashboard-integration.js` | — | ✅ `dashboard-e2e.js` |
| Leads (público) | ✅ `leads-unit.js` | ✅ `leads-integration.js` | — | ✅ `leads-e2e.js` |
| Workflow de leads | ✅ `workflow-unit.js` | ✅ `workflow-db-integration.cjs` | ✅ `workflow-http-integration.js` | ✅ `workflow-browser-e2e.js` |
| Analítica | ✅ `analytics-unit.js` | — | — | — |
| Resolución de entorno DB | ✅ `db-env-resolution.test.js` | — | — | — |
| Política de timezone | ✅ `timezone-policy.test.js` | — | — | — |
| Idempotencia de migraciones | — | ✅ `verify-migration-idempotency.cjs` | — | — |

Vacío detectado: **no hay pruebas dedicadas para el módulo de usuarios admin** (`api/admin/users/*`, `api/admin/settings/password.js`) ni para el módulo de exportación CSV (`analytics/export.js`) — se ejercitan indirectamente solo en `admin-e2e.js` si ese flujo está cubierto ahí.

## 7. Recomendaciones priorizadas

1. Extraer el parseo de rango de fechas (`from`/`to`, tope de 366/365 días) a `lib/date-range.js` reutilizable por los 3+ endpoints que lo repiten.
2. Extraer el bloque de *facets* compartido a `lib/leads-facets.js`.
3. Añadir `EDITOR` a `ROLES` en `lib/admin-rbac.js` para alinear el enum de aplicación con el `CHECK` de la migración 002.
4. Agregar pruebas unitarias para `api/admin/users/*` y `api/admin/settings/password.js`.
5. Mantener este vault (`docs/`) actualizado en cada PR que agregue o mueva un endpoint/función — ver checklist en [[02-Flujo-de-Trabajo]] §8.

## 8. Notas de proceso de esta auditoría

- Metodología: lectura completa de código fuente (no solo nombres de archivo) para cada endpoint de `api/`, cada módulo de `lib/`, el esquema y migraciones de `db/`, y muestreo representativo de `admin/*.js` y `assets/site.js` para confirmar patrones de frontend.
- Se usó `grep -rhoE "process\.env\.[A-Z_]+"` sobre todo el árbol fuente para construir el inventario exhaustivo de variables de entorno en [[03-Variables-de-Entorno]], en vez de listarlas de memoria — así se capturaron variables usadas solo en `scripts/` (p. ej. `NEON_API_KEY`, `QA_ADMIN_EMAIL`) que no aparecían en la documentación previa (`README.md`/`GEMINI.md`).
- Los identificadores de infraestructura encontrados durante la auditoría (ID de organización/proyecto Neon en `.neon`, ID de rama prohibida en `scripts/preview-safety.js`) se **excluyeron deliberadamente** de este vault, siguiendo la instrucción de no guardar contraseñas/tokens/URLs — se referencian solo por su rol funcional.
