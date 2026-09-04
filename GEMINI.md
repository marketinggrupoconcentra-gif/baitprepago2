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
