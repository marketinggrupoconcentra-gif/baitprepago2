---
tags: [modulo/api, bait-prepago]
---

# Módulo: API pública de leads

Ver también: [[Home]] · [[frontend-landing]] · [[lib-compartida]] · [[base-de-datos]]

## Endpoint

`POST /api/leads` — `api/leads.js`

## Flujo interno (en orden)

1. Cabecera `Cache-Control: no-store, max-age=0`.
2. Rechaza métodos ≠ `POST` (405) y `Content-Type` ≠ `application/json` (415).
3. `validateLeadPayload(body)` (`lib/validation.js`) — valida teléfono (10 dígitos) y NIP (4 dígitos, solo para antispam); el NIP **no** se incluye en el resultado.
4. `parseAttribution(body, req.headers)` (`lib/attribution.js`) — extrae UTMs, `fbclid`/`gclid`, IP, user-agent, referrer, page_url.
5. `getDb()` (`lib/db.js`) — obtiene el cliente Neon; si falla la config, responde 500 sin detalle interno.
6. `checkRateLimitAndIdempotency(sql, ip, phone)` (`lib/security.js`) — bloquea por rate limit (>10 leads/IP/hora → 429) o responde éxito idempotente si el mismo teléfono se envió en los últimos 15 minutos (sin duplicar el registro).
7. `INSERT INTO leads (...)` con todos los campos de atribución; el NIP nunca llega a esta sentencia.
8. Respuesta `201 { ok: true, saved: true }` en éxito; errores de DB se registran en `console.error` pero no se exponen al cliente (mensaje genérico 500).

## Configuración

- Sin autenticación (endpoint público por diseño).
- Sin CORS explícito (se asume same-origin desde la landing).
- No usa `assertSameOrigin` (a diferencia de los endpoints admin) porque es un formulario público que puede recibir submits desde la propia página servida por el mismo origen.

## Conexiones

- Entrada: [[frontend-landing]] (formulario multi-paso de `assets/site.js`).
- Dependencias: `lib/validation.js`, `lib/attribution.js`, `lib/security.js`, `lib/db.js` — ver [[lib-compartida]].
- Escribe en la tabla `leads` — ver [[base-de-datos]].
- Es la única fuente de datos que luego consumen [[api-admin-dashboard-analytics]] y [[api-admin-leads]].
