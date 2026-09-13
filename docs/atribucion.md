# Atribución de campañas y conversiones — BAIT Prepago

Cómo llega la información de cada anuncio hasta el lead, qué se guarda y cómo se devuelve a las
plataformas (Google Ads / Meta) para optimizar campañas.

## 1. Qué captura la landing

`public/assets/site.js` lee la query string de la URL de aterrizaje y la persiste en `sessionStorage`
(`bait_utms`) para que sobreviva los 3 pasos del formulario:

| Parámetro | Quién lo pone | Uso |
|---|---|---|
| `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` | tú, en la URL del anuncio | tablas de campañas del admin, embudo por canal |
| `gclid` / `gbraid` / `wbraid` | Google Ads (auto-tagging) | canal `google_ads` + conversiones offline |
| `fbclid` | Meta (automático) | canal `meta_ads` + Conversions API |
| `fb_campaign_id`, `fb_adset_id`, `fb_ad_id` | tú, en la plantilla de URL de Meta | desglose por campaña/conjunto/anuncio |
| `_fbp`, `_fbc` (cookies) | Pixel de Meta | calidad de coincidencia en CAPI |
| `referrer`, `page_url` | navegador | `landing_url`, `referrer_host`, canal `referral/direct` |

`public/assets/js/bait-analytics.js` envía además cada paso del embudo (`page_view`, `form_step_N_start`,
`form_submitted`, `form_submit_success`, `thank_you_view`…) a `POST /api/track` con los mismos UTM.

## 2. Qué se guarda (app.lead_attribution)

- `source_category`: `google_ads` (gclid/gbraid/wbraid o utm_source google) · `meta_ads` (fbclid o utm_source
  facebook/instagram/meta) · `paid_other` · `organic` · `referral` · `direct` · `other`.
- `first_utm_*` / `last_utm_*` (primer y último toque), `landing_url` (solo con `utm_*`), `referrer_host`.
- `gclid_hash` / `fbclid_hash`: HMAC para dedupe y análisis (lo que ve el admin).
- `gclid_enc`, `gbraid_enc`, `wbraid_enc`, `fbclid_enc`, `fbp_enc`: valor real **cifrado** (AES-256-GCM). Solo lo lee el cron
  de conversiones; nunca se muestra ni se exporta.

## 3. Convención de URLs de anuncios

**Google Ads** — activa *auto-tagging* (Configuración de la cuenta → Etiquetado automático). Sufijo de URL final
sugerido a nivel de cuenta o campaña:

```
utm_source=google&utm_medium=cpc&utm_campaign={campaignid}&utm_content={adgroupid}&utm_term={keyword}
```

**Meta Ads** — en cada anuncio (o a nivel de cuenta con las reglas de URL), *Parámetros de URL*:

```
utm_source=facebook&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&fb_campaign_id={{campaign.id}}&fb_adset_id={{adset.id}}&fb_ad_id={{ad.id}}
```

(Meta añade `fbclid` sola.) Para Instagram usa `utm_source=instagram`.

**Otros canales pagados**: `utm_medium=cpc|display|paid_social` → se clasifican como `paid_other`.

Reglas: minúsculas, sin espacios (`_`), nombres de campaña estables. La tabla de campañas del admin agrupa por
`utm_campaign` tal cual llega.

## 4. Conversiones hacia las plataformas

Cada lead encola dos filas en `app.conversion_deliveries` (`google_ads` y `meta_capi`, evento `lead`). Cuando en el
admin un lead pasa a estado comercial **Ganado**, se encola el evento `won` con valor (`conversion_won_value`,
default 100 MXN). El cron `/api/cron/conversions` (cada 10 min) las envía con reintentos y backoff; sin credenciales
las marca `skipped` (no se reenvían retroactivamente).

| Proveedor | Evento `lead` | Evento `won` | Identificación |
|---|---|---|---|
| Google Ads (offline, `ClickConversion`) | acción `google_ads_conversion_action_id` | acción `google_ads_won_conversion_action_id` | `gclid`/`gbraid`/`wbraid`; si no hay, *Enhanced Conversions for Leads* con email/teléfono SHA-256 |
| Meta CAPI | `Lead` | `Purchase` (valor MXN) | `em`, `ph`, `fn`, `ln` (SHA-256), `fbc`, `fbp`, user agent |

Deduplicación con el Pixel: el `event_id` del evento `Lead` es la *idempotency key* del formulario, la misma que
`bait-analytics.js` pasa al Pixel como `eventID` en `form_submit_success`. Meta descarta el duplicado.

Configuración: `/admin/settings → Integraciones` (Google Ads, Meta Conversions API, Valor de conversión). Los
secretos se guardan cifrados en `app.settings` y se muestran enmascarados. Fallback: variables de entorno del
mismo nombre en `.env.example`.

### Google Ads — pasos
1. Centro de API → developer token (basta acceso básico para tu propia cuenta).
2. Google Cloud → OAuth client (tipo *Escritorio*) → client id / secret.
3. `GOOGLE_ADS_OAUTH_CLIENT_ID=… GOOGLE_ADS_OAUTH_CLIENT_SECRET=… node scripts/get-refresh-token.mjs` → refresh token.
4. Objetivos → Conversiones → *Nueva acción* → **Importar** → *Otras fuentes de datos o CRM* → *Seguimiento de
   conversiones a partir de clics* → nombre "Lead". El id numérico aparece en la URL (`ctId=`).
5. (Opcional) segunda acción "Portabilidad ganada" con valor.
6. Para leads sin click id activa *Enhanced conversions for leads* en la acción.

### Meta — pasos
1. Events Manager → tu Pixel → Configuración → *Conversions API* → **Generar token de acceso**.
2. Pon Pixel ID (ya usado por la landing) y el token en Integraciones.
3. Prueba con *Test event code* (Events Manager → Probar eventos) y luego vacíalo.

## 5. Eventos para GTM / GA4 / Google Ads (cliente)

`bait-analytics.js` empuja a `dataLayer` cada evento con `event`, `event_id`, `session_id`, `page_type`,
`source_category`. Para la conversión en Google Ads vía GTM, dispara la etiqueta con el evento `thank_you_view`
(página `/gracias/`) o `form_submit_success`; en GA4 el evento equivalente es `generate_lead`.
