---
tags: [modulo/frontend, bait-prepago]
---

# Módulo: Panel Administrativo (frontend)

Ver también: [[Home]] · [[api-admin-auth]] · [[api-admin-dashboard-analytics]] · [[api-admin-leads]] · [[api-admin-usuarios]] · [[../graph/architecture]]

## Páginas y sus scripts

| Página | Script | Consume |
|---|---|---|
| `admin/index.html` | — (redirección/entrada) | `GET /api/admin/session` |
| `admin/login.js` (sin HTML propio listado, sirve de handler de `admin/index.html` o vista de login) | `admin/login.js` | `GET /api/admin/session`, `POST /api/admin/login` |
| `admin/dashboard.html` | `admin/dashboard.js` | `GET /api/admin/session`, `GET /api/admin/overview?range=` |
| `admin/leads.html` | `assets/admin-leads.js` | `GET /api/admin/leads`, `GET /api/admin/leads/facets`, `GET /api/admin/leads/detail`, `POST /api/admin/leads/reveal-phone`, `POST /api/admin/leads/search`, `PATCH /api/admin/leads/status`, `GET /api/admin/leads/workflow` |
| `admin/analytics.html` | `admin/analytics.js` | `GET /api/admin/analytics`, `GET /api/admin/analytics/facets`, `GET /api/admin/analytics/export` |
| `admin/users.html` | `admin/users.js` | `GET /api/admin/users`, `POST /api/admin/users/create`, `POST /api/admin/users/update` |
| `admin/settings.html` | `admin/settings.js` | `GET /api/admin/session`, `POST /api/admin/settings/password` |

CSS por página: `admin/admin.css` (compartido/layout base), `admin/dashboard.css`, `admin/analytics.css`, `admin/users.css`, `admin/settings.css`.

## Reglas de implementación (declaradas en el encabezado de cada `admin/*.js`)

- Sin manejadores de eventos inline en el HTML.
- Sin `localStorage` / `sessionStorage` / `IndexedDB` (a diferencia de la landing pública, que sí usa `sessionStorage` para UTMs).
- Sin librerías externas — coherente con la CSP `script-src 'self'` definida en `vercel.json` para `/admin/:path*`.
- Todos los scripts corren como `type="module"` (CSP-safe).
- Fechas siempre con `Intl.DateTimeFormat(LOCALE, { timeZone: TZ, ... })`, `TZ = 'America/Mexico_City'`, `LOCALE = 'es-MX'` — constantes repetidas de forma idéntica en `dashboard.js`, `analytics.js` y `users.js` (candidatas a un pequeño módulo compartido `assets/admin-common.js` si se agrega una cuarta página).

## Patrón común de cada script de página

1. `checkSession()` → `fetch('/api/admin/session', { credentials: 'same-origin' })`; si no autenticado, redirige a login.
2. Poblar `userAvatar` / `userEmailEl` / `userRoleEl` desde la sesión.
3. Cargar datos de la página vía `fetch` a su endpoint correspondiente.
4. `escHtml(str)` — función de escape manual de HTML repetida en cada script (mismo patrón que `neutralizeCsv` de la API, pero para XSS de DOM en vez de inyección CSV) — candidata a extraerse a un módulo compartido de frontend.
5. `logoutBtn` → `POST /api/admin/logout` → redirección a login.

## Conexiones

Ver el diagrama completo en [[../graph/architecture]] (sección "Panel administrativo"). En resumen: cada página del panel habla exclusivamente con su(s) endpoint(s) de `api/admin/*`, todos protegidos por `requireAdminSession` + `hasRole` — ver [[api-admin-auth]] y [[lib-compartida]].
