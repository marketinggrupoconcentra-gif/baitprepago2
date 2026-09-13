# BAIT Prepago 2

Landing de portabilidad **BAIT Prepago** (`https://baitprepago.com`) sobre el motor **Scale** v2.0.0:
Next.js 16 (App Router) · Drizzle ORM · Neon Postgres (schema `app`) · Neon Auth (admin) · Resend · Vercel.

- **Zona horaria de negocio**: `America/Mexico_City` (ver `GEMINI.md` §5).
- **Regla de oro**: el NIP de portabilidad **nunca en claro** (`GEMINI.md` §2): se cifra solo para entregarlo a Intelix y se borra al entregar (o a las 72 h).
- **Zona protegida** (`.scale-design-lock.json`): `public/legacy/**`, `public/assets/{site.css,site.js,images/,bait-logo.svg}`,
  `public/robots.txt`, `public/sitemap.xml`. Es la landing en producción, copiada verbatim; no se rediseña.

---

## 1. Arquitectura

| Capa | Dónde | Notas |
|---|---|---|
| Landing pública | `public/legacy/index.html` + `public/assets/site.{css,js}` | Servida en `/` vía rewrite (`next.config.ts`). Páginas `/gracias/`, `/duplicado/`, `/aviso-de-privacidad/`, `/walmart-beneficios/` con barra final obligatoria (rutas relativas). |
| Analítica cliente | `public/assets/js/bait-analytics.js` | Configurado por `window.BAIT_ANALYTICS_CONFIG` en `index.html`; lee GTM/GA4/Pixel de `GET /api/analytics/config`; envía embudo a `POST /api/track`. |
| CAPTCHA propio | `POST /api/captcha/challenge` → `src/lib/security/captcha.ts` | Reto de 6 dígitos (SVG sin `<text>`), hash HMAC con `CAPTCHA_PEPPER`, un solo uso, tabla `app.captcha_challenges`. |
| Alta de lead | `POST /api/leads` (contrato de la landing) y `POST /api/v1/leads` | Mismo handler `src/lib/leads/handle-lead-request.ts`: origen → bot → rate limit distribuido → honeypot → tiempo mínimo → idempotencia → Zod (`src/lib/validators/lead-schema.ts`) → CAPTCHA → dedupe por teléfono (blind index) → transacción `submitLead`. |
| Datos | `src/db/schema/app.ts`, migraciones `src/db/migrations/0000..0011` | PII cifrada (AES-256-GCM) + blind indexes HMAC. Rol runtime de mínimo privilegio `baitprepago_app_runtime` (`src/lib/security/privilege-manifest.ts`). |
| Admin | `/admin/*` (`src/app/admin`) | Neon Auth + RBAC (`src/lib/rbac.ts`): dashboard, leads, analytics, SEM, logs (entregas a Intelix), settings, usuarios. |
| Entrega a Intelix | `/api/cron/outbox` cada 5 min → `POST {intelix_api_url}` | Outbox con claim exclusivo y reintentos; `{ chat_id, dn, compania, nombre, apellidos, nip, capturista }`. Estado y reintento manual en `/admin/logs`. |
| Crons (`vercel.json`) | `/api/cron/{outbox,nip-purge,reports,google-ads,conversions}` | `Authorization: Bearer CRON_SECRET`. `nip-purge` borra NIPs vencidos, retos CAPTCHA y buckets de rate limit; `conversions` envía leads/ganados a Google Ads (offline) y Meta CAPI. |
| Edge | `src/proxy.ts` | CSP, cabeceras de seguridad, rate limit en memoria, redirect `/gracias` → `/gracias/`, `/admin` sin sesión → login. |

Respuestas de `POST /api/leads` que consume `site.js`:

| HTTP | Cuerpo | Acción en la landing |
|---|---|---|
| 201 | `{ ok, saved, status: 'received', reference }` | → `/gracias/` |
| 409 | `{ ok:false, error:'duplicate_lead', code:'PHONE_ALREADY_REGISTERED', duplicate:{ createdAt, registeredName } }` | → `/duplicado/` (nombre enmascarado) |
| 422 | `{ error:'Invalid payload', details:[códigos], fields }` | marca campos (`phone_invalid`, `nip_invalid`, `email_invalid`, `consent_required`, `nip_valid_until_*`, `captcha_*`) |
| 429 / 403 | — | mensaje genérico |

---

## 2. Requisitos

- Node.js 20+ (Vercel usa 24 LTS).
- Proyecto Neon `sweet-mud-87845510` (base `neondb`, `TimeZone = America/Mexico_City`).
- Cuenta Vercel con el repo enlazado. Vercel CLI opcional (`npm i -g vercel`) para `vercel env pull`.

## 3. Desarrollo local

```bash
npm ci
cp .env.example .env.local        # completar (ver contrato comentado en .env.example)
npm run dev                       # http://localhost:3000
```

Variables mínimas: `DATABASE_URL` (owner, solo migraciones), `APP_DATABASE_URL` (rol runtime), `PII_ENCRYPTION_KEY`,
`PII_BLIND_INDEX_KEY`, `IP_HASH_KEY`, `CAPTCHA_PEPPER`, `CRON_SECRET`, `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET`,
`ADMIN_BOOTSTRAP_EMAIL`. Genera secretos con `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

## 4. Base de datos

```bash
npm run db:migrate                                        # drizzle-kit migrate con DATABASE_URL (owner)
node --env-file=.env.local scripts/provision-runtime-role.mjs   # crea/regrant rol baitprepago_app_runtime → APP_DATABASE_URL
node --env-file=.env.local scripts/inspect-schema.mjs     # inventario del schema app
```

- Nunca uses el rol owner en runtime. El manifiesto de privilegios es la fuente de verdad de los grants.
- En Neon, `ALTER ROLE ... PASSWORD` sobre roles creados por SQL está denegado al owner: el script lo tolera y
  reaplica grants; para rotar la contraseña usa la consola/MCP de Neon (`reset_postgres_role_password`).
- Política de fechas: instantes en `TIMESTAMPTZ`; días civiles en CDMX; el fin de día es el inicio exclusivo del siguiente.

## 5. Pruebas

```bash
npm run type-check && npm run lint
npm test                 # unit + integración (usa TEST_DATABASE_URL / TEST_OWNER_DATABASE_URL — rama Neon de test)
npm run test:e2e         # Playwright (E2E_BASE_URL + cuentas E2E_*)
```

Test ≠ producción, fail-closed: `tests/integration/etapa22.test.ts` verifica que la rama (`TEST_NEON_BRANCH_ID`) no sea
`PROD_NEON_BRANCH_ID` y que el host no empiece por `PROD_NEON_ENDPOINT_PREFIX`.

Smoke manual de la landing contra un servidor local (`npm run build && npm start`):
`GET /` 200, `GET /gracias` 308 → `/gracias/`, `POST /api/captcha/challenge` 201, `POST /api/leads` 201/409/422.

## 6. Despliegue (Vercel)

- Rama `main` → producción; cualquier otra rama → Preview. `vercel.json` fija `framework: nextjs`, 5 crons y cabeceras.
- Variables de entorno de producción: todas las `[REQUIRED]` de `.env.example` (nunca las `[LOCAL]`).
- Primer administrador: `POST /api/admin/bootstrap` con `ADMIN_BOOTSTRAP_EMAIL`, o `scripts/create-admin-direct.mjs`.
- Rollback: `vercel rollback <deployment-id>` (o "Promote" del deployment anterior en el dashboard).

## 7. Seguridad y privacidad

- PII (nombre, apellido, email, teléfono) cifrada en columna; búsquedas por blind index; el teléfono se revela en admin
  solo con permiso y queda en `app.audit_logs`.
- NIP: cifrado en `lead_secrets` solo hasta que Intelix acepta el registro (o 72 h); nunca en claro, admin, exports ni logs. La fecha de vigencia se valida y se descarta.
- Anti-abuso: honeypot (`website`), tiempo mínimo de llenado (`SECURITY_MIN_FORM_FILL_MS`), idempotencia 24 h,
  rate limit distribuido (`app.rate_limits`) + edge, CAPTCHA propio, dedupe por teléfono.
- `.env*` nunca se commitea (`.gitignore`); solo `.env.example`.

## 8. UTMs y atribución

Guía completa (parámetros de URL por plataforma, qué se guarda, conversiones offline y Conversions API): `docs/atribucion.md`.

`site.js` captura `utm_*`, `gclid`, `fbclid`, `fb_ad_id/fb_adset_id/fb_campaign_id`, `referrer`, `page_url` y `session_id`.
El servidor clasifica la fuente (`src/lib/analytics/attribution.ts`), hashea los click ids (`CLICK_ID_SECRET`) y guarda
primer/último toque en `app.lead_attribution`. El embudo (`page_view → form_step_1_start → form_submitted → lead_success`)
vive en `app.analytics_events` y se visualiza en `/admin/analytics`.

## 9. Documentos de trabajo

- `project.config.yaml` — manifiesto del proyecto (zona protegida, dominio, formulario, crons).
- `docs/atribucion.md` — atribución de campañas y conversiones hacia Google Ads / Meta.
- `docs/migracion-motor-scale.md` — bitácora de la migración al motor (decisiones, supuestos, pasos de producción).
- `GEMINI.md` — reglas del proyecto para cualquier agente (stack estricto, NIP, CDMX).
