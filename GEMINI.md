# BAIT Prepago 2 — Arquitectura y Reglas del Proyecto

## 1. Stack Tecnológico Autorizado

- **Repositorio**: GitHub (`marketinggrupoconcentra-gif/baitprepago2`)
- **Infraestructura y Hosting**: Vercel
- **Base de Datos**: Neon PostgreSQL (conectado mediante Integración de Vercel)
- **Runtime de API**: Vercel Serverless Functions (`api/`)

> [!WARNING]
> **STACK ESTRICTO**
> Queda estrictamente prohibido utilizar o configurar servicios alternativos de terceros como: Cloudflare, Cloudflare Pages, Cloudflare Workers, Supabase, Firebase, Redis, WorkOS, Auth0, Clerk, Resend, etc.
> El stack es exclusivo de Vercel y Neon.

## 2. Reglas de Seguridad (PII y NIP)

El NIP (Número de Identificación Personal) que el usuario recibe por SMS es **información altamente sensible**.
1. **NO se persistirá nunca en la base de datos** (`leads` table no tiene columna `nip`).
2. **NO se pasará por la URL** al redirigir a WhatsApp u otro destino.
3. El frontend y backend validan que el NIP se introdujo correctamente para reducir spam/bots, pero una vez validado, se descarta.
4. Las credenciales de la base de datos (connection strings) no deben loguearse ni subirse a control de versiones. Usa las integraciones automáticas (`process.env.DATABASE_URL` provisto por Vercel).

## 3. Entornos y Seguridad de Preview (Fail Closed)

- Se debe utilizar el script `scripts/preview-safety.js` en los pipelines o comandos críticos para asegurar que un entorno de tipo "Preview" en Vercel nunca se conecte a la base de datos de "Producción".
- Ante la duda, los scripts o conexiones deben fallar (Fail Closed).

## 4. Arquitectura de Leads

- **Frontend**: `index.html` (página estática) + `assets/site.js` (validaciones visuales, captura de UTMs, fetch a `/api/leads`).
- **Backend (API)**: `api/leads.js` (recibe POST de leads).
  - *Validación (`lib/validation.js`)*: Verifica payload, limpia entradas y omite NIP.
  - *Seguridad (`lib/security.js`)*: Valida Rate Limiting e Idempotencia consultando a la DB.
  - *Atribución (`lib/attribution.js`)*: Captura UTMs y metadatos (ej. GCLID).
- **Base de Datos**: `db/schema.sql` y `db/migrate.js` para crear y mantener la estructura en Neon.

---
*Este documento debe ser consultado por cualquier agente antes de modificar la infraestructura o el flujo de captura de leads.*
