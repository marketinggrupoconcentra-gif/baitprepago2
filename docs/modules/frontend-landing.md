---
tags: [modulo/frontend, bait-prepago]
---

# Módulo: Landing pública

Ver también: [[Home]] · [[api-publico-leads]] · [[../graph/architecture]]

## Archivos

| Archivo | Rol |
|---|---|
| `index.html` | Landing principal de portabilidad BAIT. Incluye meta tags SEO/OG/Twitter, JSON-LD (`application/ld+json`), y el formulario multi-paso de portabilidad (`#portability-form-wrapper`). Carga `assets/site.js?v=20260907` (versión por query string para *cache busting* manual, coherente con el cache `immutable` de `vercel.json` para `/assets/*`). |
| `assets/site.css` | Estilos del sitio público. |
| `assets/site.js` | Lógica de la landing: header con scroll, animaciones *reveal on scroll* (`IntersectionObserver`, respeta `prefers-reduced-motion`), acordeón de FAQ, inputs numéricos restringidos, captura de UTMs, y el formulario multi-paso. |
| `gracias/index.html` | Página de agradecimiento post-envío del formulario. |
| `walmart-beneficios/index.html` | Landing secundaria/variante de campaña, listada en `sitemap.xml`. |

## Configuración relevante

- **WhatsApp de contacto**: constante `WHATSAPP_URL` en `assets/site.js` (número y mensaje predefinido) — es la única URL de contacto directo embebida en el frontend.
- **Captura de UTMs**: `UTM_KEYS = ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','gclid','fbclid','fb_ad_id','fb_adset_id','fb_campaign_id']`, persistidas en `sessionStorage['bait_utms']` para sobrevivir la navegación multi-página dentro de la misma sesión de navegador.
- **Versionado de assets**: `?v=YYYYMMDD` en el `<script src>` de `index.html` — se debe incrementar manualmente al desplegar cambios de `site.js` para invalidar el cache `immutable` de un año definido en `vercel.json`.

## Conexiones

- El formulario multi-paso envía el payload final a `POST /api/leads` → ver [[api-publico-leads]].
- Las UTMs capturadas en `sessionStorage` viajan como parte del `body` del POST a `/api/leads`, donde `lib/attribution.js::parseAttribution` las vuelve a extraer server-side (no confía ciegamente en el cliente).

## Reglas duras

- El NIP recibido por SMS se valida visualmente en el paso 3 del formulario pero **nunca se envía como parámetro de URL** ni se persiste — regla explícita de `GEMINI.md` §2.
