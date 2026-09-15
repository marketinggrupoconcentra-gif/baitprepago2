# BAIT Prepago 2 — Arquitectura y Reglas del Proyecto

## 1. Stack Tecnológico Autorizado

- **Repositorio**: GitHub (`marketinggrupoconcentra-gif/baitprepago2`)
- **Infraestructura y Hosting**: Vercel (Next.js 16, App Router, Fluid Compute)
- **Base de Datos**: Neon PostgreSQL, proyecto `sweet-mud-87845510`, schema `app` (Drizzle ORM, migraciones en `src/db/migrations`)
- **Autenticación del admin**: Neon Auth (servidor administrado por Neon)
- **Correo**: Brevo (Sendinblue)

> [!WARNING]
> **STACK ESTRICTO**
> Queda estrictamente prohibido utilizar o configurar servicios alternativos de terceros como: Cloudflare, Cloudflare Pages, Cloudflare Workers, Supabase, Firebase, Redis, WorkOS, Auth0, Clerk, SendGrid, Mailgun, Amazon SES, Resend, Twilio, etc.
> El stack es exclusivo de Vercel, Neon y Brevo.

## 2. Reglas de Seguridad (PII y NIP)

El NIP (Número de Identificación Personal) que el usuario recibe por SMS es **información altamente sensible**.
1. **Nunca en claro**: el NIP se cifra (AES-256-GCM, `app.lead_secrets.nip_enc`) y **solo** existe para entregarlo al CRM
   Intelix, que lo necesita para iniciar la portabilidad. Se borra en cuanto Intelix acepta el registro
   (`markDelivered`) y, en todo caso, a las `NIP_RETENTION_HOURS` (72 h) vía `/api/cron/nip-purge`.
2. **NO se pasará por la URL** al redirigir a WhatsApp u otro destino, ni aparece en el admin, exports, logs
   ni en `delivery_outbox.last_error_payload` (el payload enviado se guarda enmascarado: `nip: [REDACTED]`).
3. La fecha de vigencia del NIP se valida en el servidor y se descarta.
4. Las credenciales de la base de datos (connection strings) no deben loguearse ni subirse a control de versiones.
   El runtime usa el rol de mínimo privilegio `baitprepago_app_runtime` (`APP_DATABASE_URL`); el rol owner
   (`DATABASE_URL`) es solo para migraciones y scripts.

## 3. Entornos y Seguridad de Preview (Fail Closed)

- Test ≠ producción: `tests/integration/etapa22.test.ts` aborta si `TEST_NEON_BRANCH_ID === PROD_NEON_BRANCH_ID` o si el host de
  `TEST_DATABASE_URL` empieza por `PROD_NEON_ENDPOINT_PREFIX` (`ep-square-recipe`). Los tests de integración corren solo contra una rama Neon de test.
- Sin `APP_DATABASE_URL` el rate limiter distribuido y el alta de leads fallan cerrado (429/503). Ante la duda, fallar.
- Producción (`main` de Neon, proyecto Vercel de producción) **no se migra ni se despliega sin go-ahead explícito**, con snapshot previo de la rama.

## 4. Arquitectura de Leads

- **Frontend (zona protegida, `.scale-design-lock.json`)**: `public/legacy/index.html` + `public/assets/site.js` (3 pasos, captura de UTMs, fetch a
  `/api/captcha/challenge` y `/api/leads`, 409 → `/duplicado/`, 201 → `/gracias/`). `public/assets/js/bait-analytics.js` envía el embudo a `/api/track`.
- **Backend (API)**: `src/app/api/leads/route.ts` y `src/app/api/v1/leads/route.ts` → `src/lib/leads/handle-lead-request.ts`.
  - *Validación (`src/lib/validators/lead-schema.ts`)*: Zod estricto; normaliza email/nombres; regla del NIP condicional (§4.1). NIP y vigencia no se persisten.
  - *CAPTCHA (`src/lib/security/captcha.ts`, `src/app/api/captcha/challenge/route.ts`)*: reto de 6 dígitos, HMAC-SHA256 con `CAPTCHA_PEPPER`, un solo uso
    (`app.captcha_challenges`, `used_at` atómico), rate limit por cliente. Fail closed si `CAPTCHA_PEPPER` falta.
  - *Seguridad*: origen permitido, detección de bots, rate limit distribuido (`app.rate_limits`), honeypot, tiempo mínimo, idempotencia (`app.idempotency_keys`),
    dedupe por blind index del teléfono.
  - *Atribución (`src/lib/analytics/attribution.ts`)*: UTMs, gclid/fbclid hasheados, ids de Meta, primer/último toque en `app.lead_attribution`.
  - *Persistencia (`src/lib/leads/submit-lead.ts`)*: una transacción → `app.leads` (PII cifrada), `lead_secrets` (NIP cifrado, temporal), `lead_consents`,
    `lead_attribution`, `delivery_outbox` (pendiente para Intelix), `conversion_deliveries`, evento `lead_success`.
  - *Entrega a Intelix (`src/app/api/cron/outbox/route.ts`)*: cada 5 min, `POST {intelix_api_url}` con
    `{ chat_id, dn, compania, nombre, apellidos, nip, capturista }`; reintentos con lease/backoff; estado en `/admin/logs`.

- **Base de Datos**: `src/db/schema/app.ts` + `npm run db:migrate`; grants del rol runtime en `src/lib/security/privilege-manifest.ts`.

### 4.1 Stage 1H — NIP condicional, email, privacidad y CAPTCHA

- El NIP sigue sin persistirse. Si el NIP capturado coincide con los últimos 4 dígitos del teléfono a portar, el
  formulario exige y valida (server-side, en `lead-schema.ts`: `isWithinNipValidityWindow`) una fecha de vigencia del NIP
  dentro de la ventana `hoy..hoy+5` días naturales en `America/Mexico_City`. Esa fecha tampoco se persiste.
- `app.leads.email_enc` captura el correo (cifrado) para el envío futuro del cupón BAIT (`LEAD_CONFIRMATION_EMAIL=on` + Brevo).
- El Aviso de Privacidad vive en `/aviso-de-privacidad/` (página estática, sin JS). Su contenido legal (razón social,
  domicilio, contacto ARCO) está pendiente — ver `docs/legal/privacy-required-inputs.md`.

## 5. Política Temporal Canónica — CDMX

La zona horaria de negocio de BAIT Prepago es **`America/Mexico_City`**. Esta regla es obligatoria en base de datos, backend, filtros, reportes, dashboard, auditoría y frontend administrativo.

### 5.1 Persistencia

- Los instantes reales (`created_at`, `updated_at`, expiraciones, auditoría, sesiones, cambios de estado, etc.) deben persistirse como **PostgreSQL `TIMESTAMPTZ`**.
- **No convertir ni desplazar registros históricos** sumando/restando horas. `TIMESTAMPTZ` representa un instante; la zona de CDMX se usa al interpretar o presentar dicho instante.
- No introducir columnas nuevas de tipo `TIMESTAMP WITHOUT TIME ZONE` para instantes de negocio.
- Fechas civiles que no representan una hora/instante pueden usar `DATE` cuando corresponda.

### 5.2 Configuración Neon

El proyecto Neon de BAIT Prepago debe mantener `TimeZone = 'America/Mexico_City'` a nivel de base/rol. Antes de ejecutar una migración sensible, validar:

```sql
SELECT current_database(), current_user, current_setting('TimeZone');
```

La migración debe abortar si la zona efectiva no es `America/Mexico_City`.

### 5.3 Backend y SQL

- Toda lógica de **día calendario** debe declarar explícitamente `America/Mexico_City`; no depender de UTC ni de la zona del runtime.
- Para filtros `from/to` recibidos como `YYYY-MM-DD`, interpretar ambos como días civiles de CDMX.
- El límite superior de un día debe implementarse como **inicio exclusivo del día siguiente**, no como `23:59:59.999Z`.
- Los rangos rodantes (`últimas 24 horas`) sí se calculan como intervalos absolutos desde `NOW()`.
- Los agrupamientos diarios deben usar `created_at AT TIME ZONE 'America/Mexico_City'` o equivalente explícito.
- APIs pueden transportar instantes en ISO 8601/UTC; la presentación final debe aplicar CDMX.

### 5.4 Frontend

Toda fecha/hora visible al usuario administrativo debe formatearse con:

```js
new Intl.DateTimeFormat('es-MX', {
  timeZone: 'America/Mexico_City',
  // ...opciones de formato
});
```

Nunca depender de la zona horaria del navegador para fechas operativas.

### 5.5 Pruebas obligatorias

Toda modificación relacionada con fechas debe cubrir como mínimo:

1. Instante cercano a medianoche UTC que pertenezca al día anterior en CDMX.
2. Filtro de un único día (`from === to`) incluyendo todo el día civil de CDMX.
3. Exclusión exacta de las `00:00:00` del día siguiente en CDMX.
4. Render del mismo instante idéntico aunque el navegador/runner use otra zona horaria.
5. Verificación de `current_setting('TimeZone') = 'America/Mexico_City'` en el entorno de DB objetivo.

---
*Este documento debe ser consultado por cualquier agente antes de modificar la infraestructura o el flujo de captura de leads.*
