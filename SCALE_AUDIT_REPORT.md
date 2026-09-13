# SCALE_AUDIT_REPORT

- Fecha: 2026-09-13T08:39:52.6987644-06:00
- Destino: D:\Proyectos\baitprepago2
- Motor: 92de3ce642708100bfacff65a3d6591852e0ddde
- Resultado: **FAIL** (2 fallos, 0 advertencias)

- [ ] FAIL: Faltan 8 archivos del motor: scripts/check-neon-auth.js, scripts/create-admin.ts, scripts/debug-leads.ts, scripts/grant-settings.ts, scripts/insert-admin.ts, scripts/query-db.ts, src/app/robots.ts, src/app/sitemap.ts
- [x] Sin archivos .scale-engine pendientes
- [x] Todas las variables usadas en src/ están en .env.example (45 usadas)
- [x] .env.local tiene todas las REQUIRED de producción
- [ ] FAIL: Residuos de plantilla detectados (ver scan-template-residue.ps1):
  tests\integration\etapa22.test.ts:141  [bait_app_runtime]
  tests\unit\report-template.test.ts:65  [Bait Pospago]
  tests\unit\report-template.test.ts:65  [BAIT Pospago]
- [x] Zona protegida (landing/gracias/formulario) sin cambios respecto al lock
- [x] src/proxy.ts
- [x] src/db/schema/app.ts
- [x] src/db/migrations/meta/_journal.json
- [x] src/lib/security/privilege-manifest.ts
- [x] src/lib/rbac.ts
- [x] src/app/api/v1/leads/route.ts
- [x] src/app/api/track/route.ts
- [x] src/app/admin/(console)/layout.tsx
- [x] vercel.json
- [x] drizzle.config.ts
- [x] vercel.json → "framework": "nextjs" (evita el 404 global por preset null)
- [x] vercel.json declara 4 crons
- [x] npm run type-check
- [x] npm run lint
- [x] npx vitest run tests/unit
- [x] npm run test:integration (rama Neon de test)
