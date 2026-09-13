# Migración de BAIT Prepago al motor Scale — bitácora

Rama `feat/scale-engine` (desde `main` @ `83d6a5f9`) · motor Scale v2.0.0 · 2026-09-13.
Producción (Neon `main` `br-lingering-sun-avyoux4u` y el proyecto Vercel) **no fue tocada**. Todo lo verificado corrió en
local y en la rama Neon de test `scale-test-20260912` (`br-billowing-moon-avyvasmr`).

## 1. Qué había y qué se decidió

| Encontrado | Decisión |
|---|---|
| `main` en producción: landing estática + Vercel Functions `api/*.js` + admin vanilla + Postgres schema `public` (0 leads). | Modo **transplant**: la landing se conserva verbatim como zona protegida; API/admin/DB pasan al motor. |
| Working tree con una migración a Next 14 sin commit, landing degradada, schema `app` reducido ya aplicado en Neon `main`. | Parqueado en `wip/next-scaffold-20260912` (`ea6bc201`). No se reutiliza nada. Su schema `app` en Neon `main` deberá reemplazarse (ver §6). |
| Formulario real de 3 pasos en `assets/site.js` con CAPTCHA propio y contrato `201/409/422`. | `form: existing`. El motor se adapta al contrato de la landing, no al revés. |
| Regla del proyecto: el NIP nunca se persiste. | `submitLead` no escribe `lead_secrets`; `nip`/`nip_valid_until` solo se validan. |
| Sin CRM de destino. | La integración CRM del motor se retiró por completo (ver §8). |

## 2. Zona protegida (design lock)

Copiado sin cambios desde `main` a `public/legacy/{index.html,gracias/,duplicado/,aviso-de-privacidad/,walmart-beneficios/}`,
`public/assets/{site.css,site.js,images/,bait-logo.svg}`, `public/robots.txt`, `public/sitemap.xml` (24 archivos en `.scale-design-lock.json`).

Único cambio sancionado (wiring de analítica y anti-bot), verificado contra el design lock antes de re-snapshotear:
- `public/legacy/index.html`: `window.BAIT_ANALYTICS_CONFIG = { formId:'portability-form-wrapper', formName:'portabilidad_prepago', contentName:'BAIT Prepago', landingSections:[...] }` + `<script src="assets/js/bait-analytics.js">`; `site.js` versionado `?v=20260912`.
- `public/assets/site.js`: añade al payload `website:''` (honeypot), `form_started_at`, `idempotency_key` (se regenera tras un fallo), `session_id`; emite `BaitAnalytics.formStepView/formSubmitted/formResult`. Sigue haciendo POST a `/api/leads`.

Ids del formulario (para futuras adaptaciones): `pf-phone`, `pf-phone-confirm`, `pf-nip`, `pf-nip-confirm`, `pf-nip-valid-until`, `pf-nombre`, `pf-apellido`, `pf-email`, `pf-captcha-input`, `pf-consent`; pasos `pf-step-1..3`; estado `form-status`.

## 3. Cambios al motor (por qué)

**Nuevos**
- `src/lib/validators/lead-schema.ts` (reescrito): schema estricto del payload prepago; NIP == últimos 4 del teléfono ⇒ `nip_valid_until` obligatorio en `hoy..hoy+5` (CDMX); `leadErrorCodes()` devuelve los códigos que `site.js` pinta por campo.
- `src/lib/security/captcha.ts` + `src/app/api/captcha/challenge/route.ts`: CAPTCHA propio portado de `lib/captcha.js` (HMAC con `CAPTCHA_PEPPER`, SVG sin `<text>`, single-use atómico, rate limit `captcha-challenge` 20/600 s).
- `src/lib/leads/handle-lead-request.ts` + `src/app/api/leads/route.ts`: handler compartido con `api/v1/leads`; respuestas `201 {ok,saved,status,reference}`, `409 duplicate_lead` (nombre enmascarado `P*** S***`), `422 {error,details,fields}`.
- Migración `0008_prepago_form_captcha.sql`: `leads.birthdate_enc`/`state_code` nullable, `plan_code` default `prepago_100`, `lead_attribution.fb_ad_id/fb_adset_id/fb_campaign_id`, tabla `app.captcha_challenges`, corrección de drift en `ads_metrics` (el snapshot 0007 del motor no coincidía con `app.ts`).
- Tests: `tests/unit/lead-schema-prepago.test.ts`, `tests/unit/captcha.test.ts`.

**Adaptados** (ver `git diff main..feat/scale-engine -- src tests scripts`)
- `submit-lead.ts`: `birthdateEnc/stateCode` opcionales, `nipEnc` opcional (sin `lead_secrets`).
- `privilege-manifest.ts`: rol `baitprepago_app_runtime`; `+captcha_challenges`, `-otp_proofs`.
- `proxy.ts`: rutas estáticas de la landing, redirect `/gracias`→`/gracias/` (308) hecho aquí porque el matcher de `next.config` ignora la barra final y hacía bucle; CSP sin hosts Intelix; sin inyección GTM en HTML (la landing no tiene placeholders — GTM/GA4/Pixel los carga `bait-analytics.js` desde `/api/analytics/config`).
- `next.config.ts`/`vercel.json`: `skipTrailingSlashRedirect`, rewrites `/`→`/legacy/index.html` y `/<dir>/`→`/legacy/<dir>/index.html`, `www`→apex, `framework: nextjs`, 4 crons.
- Crons: `nip-purge` purga también CAPTCHAs; `reports` adaptado al formulario prepago.
- Admin: `LeadsClient`, `LeadDrawer`, `LeadDetailClient`, `DashboardClient`, `LogsClient`, `AnalyticsClient` (secciones de esta landing), `SettingsClient` (campos del formulario prepago), exports, `[id]` (sin stack trace en respuesta), marca/logo `/assets/bait-logo.svg`.
- Emails: `coupon-template.ts` (prepago), `report-template.ts`, `sender.ts`. `origin.ts` (`baitprepago.com`), `auth.ts`, `rbac.ts`, `db/index.ts`, `RUNTIME_ROLE.md`, `firewall-setup.sh`.
- `scripts/provision-runtime-role.mjs`: tolera `ALTER ROLE … PASSWORD` denegado en Neon (reaplica grants y avisa).
- `scripts/get-refresh-token.mjs`: OAuth client desde `GOOGLE_ADS_OAUTH_CLIENT_ID/SECRET` (antes hardcodeado).
- Tests del motor: `track-api.test.ts` y `schema-real.test.ts` fuerzan `TEST_*` (antes podían pegarle a `.env.local` de prod); `etapa22.test.ts` lee rol/branch de env y pasa `outboxDestination` en el test de concurrencia; espera 18 tablas.

**Eliminados a propósito** (por eso `audit-project` §1 marca FAIL — aceptado):
`src/app/robots.ts`, `src/app/sitemap.ts` (los estáticos de `main` son zona protegida y los sustituyen),
`scripts/{grant-settings,insert-admin,debug-leads,query-db,create-admin}.ts`, `scripts/check-neon-auth.js` (utilidades ad-hoc del proyecto de origen del motor).

## 4. ASUMIDOS (defaults del motor / decisiones sin dato del usuario)

| Supuesto | Dónde cambiarlo |
|---|---|
| `plan_code = prepago_100` para todo lead. | `LEAD_PLAN_CODE`. |
| Email de confirmación al lead **apagado**. | `LEAD_CONFIRMATION_EMAIL=on` (requiere Resend). |
| `ALLOWED_ORIGINS = baitprepago.com, www, baitprepago2.vercel.app`. | `ALLOWED_ORIGINS` (añadir alias de Preview si se prueba el formulario ahí). |
| Host canónico `baitprepago.com` (www → apex 301). | `CANONICAL_HOST` en `next.config.ts`. |
| Nombre del rol runtime `baitprepago_app_runtime` (nuevo; `bait_app_prod` del sitio vanilla se deja intacto). | `project.config.yaml` / `RUNTIME_ROLE_NAME`. |
| Secretos locales (`PII_*`, `IP_HASH_KEY`, `CAPTCHA_PEPPER`, `CRON_SECRET`, `NEON_AUTH_COOKIE_SECRET`) generados nuevos para `.env.local`. Producción debe tener los suyos (no se copian). | Vercel env. |
| `PII_ENCRYPTION_KEY` anterior de `.env.local` no era hex de 64; se generó una nueva (respaldo `.env.local.bak-pre-scale`). No hay datos cifrados en prod que dependan de ella (0 leads). | — |
| Duplicados: se responde 409 con nombre enmascarado igual que el sitio vanilla; no se crea lead ni evento. | `handle-lead-request.ts`. |
| Secciones de analytics nombradas por `id` de la landing. | `BAIT_ANALYTICS_CONFIG.landingSections` en `index.html` (zona protegida: solo wiring). |

## 5. `pending_credential` (módulos que degradan hasta tener la credencial)

| Módulo | Variable exacta | Efecto mientras falte |
|---|---|---|
| Emails (reportes programados, confirmación al lead) | `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | `cron/reports` registra y no envía; `LEAD_CONFIRMATION_EMAIL` debe quedar `off`. |
| Tag Manager / GA4 / Meta Pixel en la landing | `NEXT_PUBLIC_GTM_ID` (o `NEXT_PUBLIC_GA4_ID`), `NEXT_PUBLIC_META_PIXEL_ID` | `bait-analytics.js` solo envía el embudo interno a `/api/track`. |
| Google Ads (SEM) | `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CREDENTIALS_B64`, `GOOGLE_ADS_REFRESH_TOKEN`, `GOOGLE_ADS_ACCOUNT_ID` | `/admin/sem` muestra "no conectado"; `cron/google-ads` no-op. |
| Meta CAPI | `META_PIXEL_ID`, `META_CAPI_ACCESS_TOKEN` | Sin uso en el motor actual. |
| Vercel CLI | sesión `vercel whoami` | Las env vars de producción/preview se cargan por dashboard o CLI (lista abajo). |

**Env vars a cargar en Vercel (Production; Preview apuntando a la rama de test):**
`APP_DATABASE_URL` (rol runtime; el owner `DATABASE_URL` NO va en Vercel — migraciones desde local),
`PII_ENCRYPTION_KEY`, `PII_BLIND_INDEX_KEY`, `IP_HASH_KEY`, `CAPTCHA_PEPPER`, `CRON_SECRET`, `CLICK_ID_SECRET`,
`APP_URL`, `ALLOWED_ORIGINS`, `LEAD_PLAN_CODE`, `LEAD_CONFIRMATION_EMAIL=off`,
`NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET`, `ADMIN_BOOTSTRAP_EMAIL`, `PRIVACY_POLICY_VERSION`, `TERMS_VERSION`,
opcionales: `RESEND_*`, `NEXT_PUBLIC_GTM_ID`, `NEXT_PUBLIC_META_PIXEL_ID`, `GOOGLE_ADS_*`.
`next build` necesita `NEON_AUTH_BASE_URL` y `NEON_AUTH_COOKIE_SECRET` presentes → sin ellas el Preview falla en build.

Preview (rama Neon de test): Neon Auth ya está provisionado (`better_auth`, gestionado por Neon) →
`NEON_AUTH_BASE_URL=https://ep-dry-thunder-ava45ynu.neonauth.c-11.us-east-1.aws.neon.tech/neondb/auth`.
Estado del Preview `dpl_B33p934xBatg455xg5ihNkaJFKsj` (commit `2b3bc359`): compila y pasa TypeScript; falla en
"Collecting page data" con `[auth] NEON_AUTH_BASE_URL no está definida` — solo faltan las env vars; basta un Redeploy tras cargarlas.
El equivalente para producción (`br-lingering-sun-avyoux4u`) se lee con `get_auth` (lectura de prod: requiere tu autorización).

## 6. Producción — estado

**Ejecutado el 2026-09-13 con autorización explícita del usuario (base de datos Neon `sweet-mud-87845510`):**

1. ✅ Snapshot de Neon `main`: `snap-gentle-base-avw2c3co` (`pre-scale-engine-20260913`). Estado previo: `app` 17 tablas (WIP), `drizzle` 1, `public` 19; 0 leads en todas.
2. ✅ `DROP SCHEMA app CASCADE; DROP SCHEMA drizzle CASCADE;` en `main` (una transacción). `public` intacto.
3. ✅ `drizzle-kit migrate` con el owner → 9 migraciones (0000–0008), 18 tablas en `app`, `TimeZone = America/Mexico_City`.
4. ✅ `scripts/provision-runtime-role.mjs` → rol `baitprepago_app_runtime` con los grants del manifiesto; contraseña fijada con
   `reset_postgres_role_password`. Verificado: conecta, `DELETE app.leads` denegado (42501), `public.leads` denegado (42501).
   URL guardada en `.env.prod.runtime` (gitignored).
5. ✅ Neon Auth en `main` provisionado (`better_auth`, gestionado por Neon):
   `NEON_AUTH_BASE_URL=https://ep-square-recipe-avlk7lu1.neonauth.c-11.us-east-1.aws.neon.tech/neondb/auth`.
   Nota: `app.admin_profiles` quedó vacío (el registro del WIP se eliminó con el schema) → hace falta el bootstrap del primer admin (paso 8).

**Pendiente:**

5b. Aplicar las migraciones `0009`…`0011` en Neon `main` (`DATABASE_URL=<owner main> npm run db:migrate`, luego
   `scripts/provision-runtime-role.mjs` para resincronizar grants). Elimina dos tablas vacías; ya aplicada en la rama de test.


6. Cargar en Vercel (Production) el contenido de `.env.production.vercel` (gitignored; secretos nuevos generados, rol runtime, Neon Auth).
   Con CLI: `vercel env add <NAME> production` por variable, o pegar en Settings → Environment Variables.
   Para Preview usar los valores de la rama de test (`.env.scale-test`) — nunca los de producción.
7. Merge `feat/scale-engine` → `main` (squash) → deploy de producción. Hasta que existan las env vars, un merge produciría un build
   fallido en Vercel (el deployment vanilla actual permanecería activo, pero no conviene).
8. Smoke prod: `GET /` 200, `GET /gracias/` 200, `GET /api/analytics/config` 200, `GET /admin` → login,
   `POST /api/admin/bootstrap` (primer admin = `ADMIN_BOOTSTRAP_EMAIL`), lead de prueba → `/admin/dashboard` + `/admin/analytics`, luego borrarlo.
9. Rollback: "Promote" del deployment anterior en Vercel (el sitio vanilla lee `public.*`, intacto) y/o restaurar el snapshot
   `snap-gentle-base-avw2c3co` para volver al estado previo de `app`/`drizzle`.

## 7. Verificación (comandos y resultado)

| Comando | Resultado |
|---|---|
| `npm run type-check` | OK |
| `npm run lint` | 0 errores |
| `npm test` (env `.env.local` + `TEST_*`) | 278 passed, 1 skipped |
| `npm run build` | OK (rutas dinámicas, `ƒ Proxy`) |
| `next start -p 3077` + curl | `/` 200 (SEO + `bait-analytics.js`), `/gracias` 308→`/gracias/`, `/gracias/` `/duplicado/` `/aviso-de-privacidad/` `/walmart-beneficios/` 200, `/assets/site.js` `/robots.txt` `/sitemap.xml` 200, `/api/analytics/config` 200, `/admin` 307→`/admin/login`, `GET /api/track` 405 |
| `POST /api/captcha/challenge` | 201 `{challengeId,image(data:svg),expiresAt}` |
| `POST /api/leads` (payload de `site.js`) | 201 → `app.leads` 1 fila (`received`, `prepago_100`, `birthdate_enc` null, `state_code` null); `lead_attribution` (`google_ads`, utms, `gclid_hash`); `lead_consents`; `analytics_events.lead_success`; `lead_secrets` **0 filas** |
| Replay misma `idempotency_key` | 201 misma `reference` (sin duplicar) |
| Mismo teléfono, CAPTCHA nuevo | 409 `duplicate_lead` / `PHONE_ALREADY_REGISTERED`, `registeredName: "P*** S***"` |
| CAPTCHA reutilizado | 422 `captcha_used` |
| `POST /api/track` | 200 |
| `verify-design-lock.ps1 -Verify` | solo `index.html` + `site.js` (wiring) → `-Snapshot` → OK 24 archivos |
| `scan-template-residue.ps1` | sin residuos |
| `audit-project.ps1 -RunChecks` | §1 FAIL esperado (8 eliminados a propósito, §3); §2–§7 OK (env contract 45/45, design lock, estructura, type-check/lint/unit/integration) |

## 8. Pulido posterior (2026-09-13)

- Retirada la integración CRM heredada del motor (outbox, cron `/api/cron/outbox`, módulo Logs del admin, ajustes de CRM,
  indicadores "entrega a CRM"): este proyecto no entrega leads a ningún CRM. Migración `0009_drop_crm_outbox` elimina
  `app.delivery_outbox`, `app.integration_deliveries` y sus tipos (tablas vacías).
- Reporte periódico simplificado: leads recibidos, portabilidades ganadas, desglose por fuente y por estado comercial.
- `GET /api/admin/analytics/acquisition` tenía la autenticación comentada (heredado): restaurada con `analytics.view`.
- Atribución/conversiones (migración 0010): click ids reales cifrados, cola `app.conversion_deliveries`, cron
  `/api/cron/conversions` (Google Ads offline + Meta CAPI), credenciales en `/admin/settings`. Ver `docs/atribucion.md`.
- Intelix reincorporado (migración 0011) con el contrato real de portabilidad (`chat_id, dn, compania, nombre, apellidos, nip,
  capturista`), módulo Logs del admin y NIP cifrado temporal (`GEMINI.md` §2).
- Eliminados archivos ajenos al proyecto: reportes generados por las herramientas de migración, `.neon` de otro proyecto,
  `.obsidian`, scripts sueltos, un scaffold CRA (`mi-app/`) y un build antiguo (`dist/`).
