# SCALE_TRANSPLANT_REPORT

- Fecha: 2026-09-12T23:47:44.7768523-06:00
- Modo: **transplant**
- Motor: D:\Contexto\Planes\Scale\engine (SHA fuente `92de3ce642708100bfacff65a3d6591852e0ddde`, generado 09/12/2026 22:54:53)
- Destino: D:\Proyectos\baitprepago2

| Resultado | Cantidad |
|---|---|
| Copiados | 161 |
| Identicos (ya estaban) | 0 |
| CONFLICTOS (.scale-engine pendiente de fusion) | 4 |
| Zona protegida (omitidos a proposito) | 0 |
| Placeholders de landing | 0 |

## CONFLICTOS - el Agente DEBE fusionar sin preguntar
Para cada archivo: abre <archivo> (version del destino) y <archivo>.scale-engine (version del motor).
Regla: conserva TODO lo del destino que sea de landing/diseno/negocio propio; incorpora TODO lo del motor
(seguridad, DB, auth, admin, analitica). Al terminar, borra el .scale-engine. scripts/audit-project.ps1 falla si queda alguno.

- [ ] `.env.example`
- [ ] `.gitignore`
- [ ] `package-lock.json`
- [ ] `package.json`

## Siguientes pasos (autonomos, en este orden)
1. Fusionar conflictos (arriba) y eliminar los .scale-engine.
2. Rellenar project.config.yaml (copiar desde el playbook si no existe) con los datos reales del destino.
3. Ejecutar scripts/scan-template-residue.ps1 -TargetRepo <destino> y reemplazar marca/dominio/IDs en los archivos listados.
4. npm install -> npm run type-check -> npm run lint -> npm test.
5. Provisionar BD/Auth/Secrets segun README.md, seccion Runbook (Neon branch + rol runtime + migraciones).
6. scripts/audit-project.ps1 -TargetRepo <destino> -RunChecks debe terminar en 0.

## Detalle
<details><summary>Copiados (161)</summary>

- AGENTS.md
- drizzle.config.ts
- eslint.config.mjs
- next.config.ts
- playwright.config.ts
- postcss.config.mjs
- public/assets/js/bait-analytics.js
- public/assets/js/bait-lead-submit.js
- scripts/check-leads.mjs
- scripts/check-neon-auth.js
- scripts/create-admin-direct.mjs
- scripts/create-admin-http.mjs
- scripts/create-admin.ts
- scripts/debug-leads.ts
- scripts/firewall-setup.sh
- scripts/get-refresh-token.mjs
- scripts/grant-settings.ts
- scripts/insert-admin.ts
- scripts/inspect-schema.mjs
- scripts/provision-runtime-role.mjs
- scripts/query-db.ts
- scripts/run-migrations.mjs
- src/app/admin/(auth)/forgot-password/page.tsx
- src/app/admin/(auth)/login/page.tsx
- src/app/admin/(auth)/reset-password/page.tsx
- src/app/admin/(console)/analytics/page.tsx
- src/app/admin/(console)/dashboard/page.tsx
- src/app/admin/(console)/layout.tsx
- src/app/admin/(console)/leads/[id]/page.tsx
- src/app/admin/(console)/leads/page.tsx
- src/app/admin/(console)/logs/page.tsx
- src/app/admin/(console)/settings/page.tsx
- src/app/admin/(console)/users/page.tsx
- src/app/admin/layout.tsx
- src/app/admin/page.tsx
- src/app/api/admin/analytics/acquisition/route.ts
- src/app/api/admin/analytics/funnel/route.ts
- src/app/api/admin/analytics/summary/route.ts
- src/app/api/admin/bootstrap/route.ts
- src/app/api/admin/dashboard/summary/route.ts
- src/app/api/admin/leads/[id]/route.ts
- src/app/api/admin/leads/[id]/status/route.ts
- src/app/api/admin/leads/assignable-users/route.ts
- src/app/api/admin/leads/export/route.ts
- src/app/api/admin/leads/route.ts
- src/app/api/admin/logs/[id]/route.ts
- src/app/api/admin/logs/export/route.ts
- src/app/api/admin/logs/fix/route.ts
- src/app/api/admin/logs/retry/route.ts
- src/app/api/admin/logs/route.ts
- src/app/api/admin/nav/counts/route.ts
- src/app/api/admin/reports/schedules/route.ts
- src/app/api/admin/settings/route.ts
- src/app/api/admin/users/[id]/activity/route.ts
- src/app/api/admin/users/[id]/route.ts
- src/app/api/admin/users/route.ts
- src/app/api/analytics/config/route.ts
- src/app/api/auth/[...path]/route.ts
- src/app/api/cron/google-ads/route.ts
- src/app/api/cron/nip-purge/route.ts
- src/app/api/cron/outbox/route.ts
- src/app/api/cron/reports/route.ts
- src/app/api/track/route.ts
- src/app/api/v1/leads/route.ts
- src/app/api/webhooks/google-ads/route.ts
- src/app/favicon.ico
- src/app/globals.css
- src/app/layout.tsx
- src/app/not-found.tsx
- src/app/robots.ts
- src/app/sitemap.ts
- src/components/admin/AdminSidebar.tsx
- src/components/admin/AnalyticsClient.tsx
- src/components/admin/DashboardClient.tsx
- src/components/admin/LeadDetailClient.tsx
- src/components/admin/LeadDrawer.tsx
- src/components/admin/LeadsClient.tsx
- src/components/admin/LogsClient.tsx
- src/components/admin/SettingsClient.tsx
- src/components/admin/UsersClient.tsx
- src/components/TrackingProvider.tsx
- src/db/index.ts
- src/db/migrations/0000_true_bullseye.sql
- src/db/migrations/0001_boring_madame_masque.sql
- src/db/migrations/0002_etapa22_otp_rate_outbox.sql
- src/db/migrations/0003_audit_action_outbox_retry.sql
- src/db/migrations/0004_lovely_red_ghost.sql
- src/db/migrations/0005_aspiring_spiral.sql
- src/db/migrations/0006_silky_lethal_legion.sql
- src/db/migrations/0007_amused_ender_wiggin.sql
- src/db/migrations/meta/_journal.json
- src/db/migrations/meta/0000_snapshot.json
- src/db/migrations/meta/0001_snapshot.json
- src/db/migrations/meta/0002_snapshot.json
- src/db/migrations/meta/0003_snapshot.json
- src/db/migrations/meta/0004_snapshot.json
- src/db/migrations/meta/0005_snapshot.json
- src/db/migrations/meta/0006_snapshot.json
- src/db/migrations/meta/0007_snapshot.json
- src/db/RUNTIME_ROLE.md
- src/db/schema/app.ts
- src/lib/attribution-server.ts
- src/lib/attribution.ts
- src/lib/audit.ts
- src/lib/auth-client.ts
- src/lib/auth.ts
- src/lib/business-time.ts
- src/lib/crypto.ts
- src/lib/email/coupon-template.ts
- src/lib/email/report-template.ts
- src/lib/email/sender.ts
- src/lib/intelix-errors.ts
- src/lib/leads/submit-lead.ts
- src/lib/log.ts
- src/lib/outbox/claim.ts
- src/lib/outbox/errors.ts
- src/lib/outbox/intelix-log.ts
- src/lib/rbac.ts
- src/lib/security/bot-id.ts
- src/lib/security/bot-signatures.ts
- src/lib/security/csv.ts
- src/lib/security/edge-guard.ts
- src/lib/security/edge-rate-limit.ts
- src/lib/security/honeypot.ts
- src/lib/security/idempotency.ts
- src/lib/security/ip-hash.ts
- src/lib/security/origin.ts
- src/lib/security/privilege-manifest.ts
- src/lib/security/rate-limiter.ts
- src/lib/security/timing.ts
- src/lib/session.ts
- src/lib/settings.ts
- src/lib/validators/lead-schema.ts
- src/proxy.ts
- tests/__mocks__/server-only.ts
- tests/e2e/admin-auth.spec.ts
- tests/e2e/landing-events.spec.ts
- tests/e2e/track-api.spec.ts
- tests/integration/etapa22.test.ts
- tests/integration/phase2.2.test.ts
- tests/integration/track-api.test.ts
- tests/unit/admin-rbac.test.ts
- tests/unit/attribution.test.ts
- tests/unit/auth-architecture.test.ts
- tests/unit/bot-signatures.test.ts
- tests/unit/cron-auth.test.ts
- tests/unit/crypto.test.ts
- tests/unit/csv-security.test.ts
- tests/unit/edge-guard.test.ts
- tests/unit/env-contract.test.ts
- tests/unit/log-redaction.test.ts
- tests/unit/origin.test.ts
- tests/unit/proxy-convention.test.ts
- tests/unit/report-template.test.ts
- tests/unit/schema-real.test.ts
- tests/unit/security.test.ts
- tests/unit/timezone.test.ts
- tests/unit/vercel-config.test.ts
- tsconfig.json
- vercel.json
- vitest.config.ts

</details>
<details><summary>Identicos (0)</summary>


</details>
