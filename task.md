# task.md — Migración de BAIT Prepago al motor Scale (checklist operativo)

Rama `feat/scale-engine` · base `main` @ `83d6a5f9` · playbook Scale v2.0.0 (engine SHA `92de3ce`) · 2026-09-12/13

## FASE 1 — Descubrimiento
- [x] Inventario del repo (`main` = landing estática + Vercel Functions `api/*.js` + Postgres schema `public`).
- [x] WIP sin commit (Next 14 con landing degradada) parqueado en `wip/next-scaffold-20260912` (`ea6bc201`).
- [x] Estado real de Neon `main`: ya contenía schema `app` (WIP reducido, 17 tablas) + schema `drizzle` + 1 `app.admin_profiles`; 0 leads en `public.leads` y en `app.leads`; rol `bait_app_prod` existente.
- [x] `project.config.yaml` escrito (slug `baitprepago2`, modo `transplant`, form `existing`, crm `none`).

## FASE 2 — Plan
- [x] `implementation_plan.md`.

## FASE 3 — Ejecución
- [x] `clone-engine.ps1 -Mode transplant` → 161 copiados, 4 conflictos fusionados (`.gitignore`, `package.json`, `README.md`, `.env.example`).
- [x] Zona protegida verbatim de `main` → `public/legacy/**`, `public/assets/**`, `robots.txt`, `sitemap.xml`; lock `.scale-design-lock.json`.
- [x] Wiring sancionado: `index.html` carga `bait-analytics.js` + `BAIT_ANALYTICS_CONFIG`; `site.js` añade `website`, `form_started_at`, `idempotency_key`, `session_id` y llama `BaitAnalytics.*`.
- [x] `lead-schema.ts` reescrito para el payload prepago (NIP condicional, sin fecha de nacimiento ni estado).
- [x] Schema + migración `0008_prepago_form_captcha` (nullable `birthdate_enc`/`state_code`, `plan_code` default `prepago_100`, `fb_*` en atribución, `app.captcha_challenges`, drift `ads_metrics`).
- [x] CAPTCHA propio portado (`src/lib/security/captcha.ts`, `POST /api/captcha/challenge`); purga en `nip-purge`.
- [x] Handler compartido `handle-lead-request.ts` para `POST /api/leads` y `POST /api/v1/leads` (201/409/422/429 compatibles con `site.js`).
- [x] `submit-lead.ts`: sin `lead_secrets`, outbox solo con `CRM_PROVIDER != none`.
- [x] `proxy.ts` / `next.config.ts` / `vercel.json`: landing estática en `/`, rutas con barra final, CSP sin Intelix, host canónico `baitprepago.com`.
- [x] Admin null-safe (birthdate/state) + marca BAIT Prepago; emails; `origin.ts`; `rbac.ts`; `privilege-manifest.ts` (`baitprepago_app_runtime`, `captcha_challenges`).
- [x] Residuos de plantilla: 0 (`scan-template-residue.ps1`).
- [x] `.env.example` reescrito como contrato (45 variables usadas en `src/` cubiertas).
- [x] Neon: rama de test `scale-test-20260912` (`br-billowing-moon-avyvasmr`) → `app`/`drizzle` del WIP eliminados **solo ahí** → migraciones 0000–0008 → rol `baitprepago_app_runtime` provisionado (password vía MCP `reset_postgres_role_password`).
- [x] `README.md` y `GEMINI.md` actualizados al motor.
- [ ] Vercel: env vars de Preview/Producción (requiere CLI/dashboard autenticado → `walkthrough.md` §5).
- [ ] Neon `main`: aplicar migraciones + rol runtime (**solo con go-ahead**, `walkthrough.md` §6).

## FASE 4 — Verificación
- [x] `npm run type-check` OK · `npm run lint` 0 errores.
- [x] `npm test` → 278 passed / 1 skipped (unit + integración contra la rama Neon de test).
- [x] `npm run build` OK (rutas dinámicas, Proxy presente).
- [x] Smoke local (`next start -p 3077`): `/` 200, `/gracias` 308→`/gracias/`, páginas estáticas 200, assets/robots/sitemap 200, `/api/analytics/config` 200, `/admin` 307→login, `POST /api/captcha/challenge` 201.
- [x] Lead end-to-end: 201 → `app.leads` (`prepago_100`, sin birthdate/state) + `lead_attribution` (`google_ads`, gclid hash) + `lead_consents` + evento `lead_success`; `lead_secrets` = 0 filas; replay con misma `idempotency_key` → misma `reference`; mismo teléfono con CAPTCHA nuevo → 409 `duplicate_lead` (nombre enmascarado); CAPTCHA reutilizado → 422 `captcha_used`; `POST /api/track` 200.
- [x] `verify-design-lock.ps1 -Verify` → solo `index.html` y `site.js` (wiring) → re-snapshot → exit 0.
- [x] `audit-project.ps1 -RunChecks` → §2–§7 OK; §1 FAIL esperado (8 archivos del motor eliminados a propósito, ver `walkthrough.md` §3).

## FASE 5 — Entrega
- [x] `walkthrough.md`.
- [ ] Commits atómicos en `feat/scale-engine` + push (Preview).
- [ ] Hallazgos al playbook (`35_change_log_knowledge.md`) — listados en `walkthrough.md` §8, pendientes de escribir en `D:\Contexto\Planes\Scale`.
