# Plan de implementación — motor Scale sobre BAIT Prepago (baitprepago2)

Fecha: 2026-09-12 · Playbook Scale v2.0.0 (engine SHA `92de3ce`) · Modo **transplant** · Rama `feat/scale-engine` (desde `main` @ `83d6a5f9`).

## 1. Estado encontrado (FASE 1)
- `main` = sitio vanilla en producción: landing estática (`index.html`, `assets/`, `gracias/`, `duplicado/`, `aviso-de-privacidad/`, `walmart-beneficios/`) + Vercel Functions `api/*.js` + admin vanilla + Postgres en schema `public` (Neon `sweet-mud-87845510`).
- Working tree contenía una migración a Next 14 **sin commit** con la landing degradada. Parqueada en `wip/next-scaffold-20260912` (commit `ea6bc201`). No se usa.
- Formulario real: `assets/site.js` (3 pasos, vanilla JS, captcha propio `/api/captcha/challenge`, POST `/api/leads`, 409 `duplicate_lead` → `/duplicado/`). **NIP nunca se persiste** (regla del proyecto, `GEMINI.md`).

## 2. Zona protegida (verbatim de `main` → `public/`)
`public/legacy/{index.html,gracias/,duplicado/,aviso-de-privacidad/,walmart-beneficios/}`, `public/assets/{site.css,site.js,images/,bait-logo.svg}`, `public/robots.txt`, `public/sitemap.xml`. Lock: `.scale-design-lock.json`.
Único cambio sancionado (wiring, `02_forms_logic.md` §1 y `36` §5.4-5.5): `site.js` añade al payload `website`, `form_started_at`, `idempotency_key`, `session_id` y llama a `BaitAnalytics.*`; `index.html` carga `/assets/js/bait-analytics.js`. Se re-snapshotea el lock tras el wiring.

## 3. Adaptación del motor (36 §5)
1. `lead-schema.ts`: payload prepago (`phone`, `nip` [validación + `nip_valid_until` condicional], `nombre`, `apellido`, `email`, `consent`, `captcha_*`, utms, `gclid/fbclid/fb_*`, `referrer`, `page_url`, + anti-bot).
2. `schema/app.ts` + migración `0008_prepago`: `leads.birthdate_enc`/`state_code` nullable, `plan_code` default `prepago_100`, `lead_attribution.fb_ad_id/fb_adset_id/fb_campaign_id`, tabla `app.captcha_challenges`, corrección de drift `ads_metrics`.
3. `submit-lead.ts`: sin `lead_secrets` (NIP no se persiste), outbox solo si `CRM_PROVIDER != none`.
4. Rutas: `POST /api/leads` (contrato de la landing) + `POST /api/v1/leads` (mismo handler); `POST /api/captcha/challenge` portado (HMAC `CAPTCHA_PEPPER`, single-use, rate limit distribuido).
5. Admin: `LeadsClient`/`LeadDrawer`/`LeadDetailClient`/`export`/`logs` toleran `birthdate`/`state` nulos; textos "portabilidad pospago" → prepago.
6. `proxy.ts`: CSP sin hosts de Intelix, rutas estáticas `/`, `/gracias/`, `/duplicado/`, `/aviso-de-privacidad/`, `/walmart-beneficios/`; sin inyección de GTM en HTML (la landing no tiene placeholders).
7. `next.config.ts`/`vercel.json`: rewrites de la landing, `skipTrailingSlashRedirect`, `CANONICAL_HOST=baitprepago.com`; robots/sitemap estáticos de `main` (se eliminan `robots.ts`/`sitemap.ts`).
8. Residuos: marca, dominio, IDs Neon, rol runtime `baitprepago_app_runtime`, Intelix.

## 4. Infra (FASE 3, pasos 4-8 del README)
- Neon: rama de test `scale-test-20260912` desde `main` del proyecto `sweet-mud-87845510` → migraciones 0000-0008 → rol runtime → `TEST_DATABASE_URL`. **`main` de Neon NO se toca** (schema `app` es aditivo, pero se aplica solo con go-ahead explícito, con snapshot previo).
- Neon Auth: verificar provisión (`.env.local` ya trae `NEON_AUTH_BASE_URL`).
- Vercel: push de la rama → Preview. Env vars de Preview requieren CLI autenticada → listadas como pendientes.

## 5. Verificación (FASE 4)
`type-check`, `lint`, `test` (unit), `verify-test-db`, `test:integration` contra la rama Neon, `build`, `verify-design-lock -Verify`, `audit-project -RunChecks`, lead de prueba end-to-end local.
