# BAIT Prepago 2

## Arquitectura

- **Frontend**: HTML/JS/CSS estático
- **Backend**: Vercel Serverless Functions (`api/leads.js`)
- **Base de Datos**: Neon PostgreSQL
- **Zona horaria de negocio**: `America/Mexico_City`

## Requisitos

- Node.js 18+
- Cuenta en [Neon](https://neon.tech)
- Vercel CLI (`npm i -g vercel`)

---

## 1. Configuración de Base de Datos

1. Crear proyecto en Neon.
2. Linkear Neon a Vercel con la integración oficial. Vercel inyectará `POSTGRES_URL` o `DATABASE_URL` de manera segura.
3. Confirmar que la zona efectiva del proyecto es CDMX:

   ```sql
   SELECT current_setting('TimeZone');
   ```

   Debe devolver `America/Mexico_City`.
4. Ejecutar las migraciones: `npm run db:migrate`.

### Política de fechas

- Los instantes se guardan con `TIMESTAMPTZ`.
- No se deben sumar/restar horas a registros históricos para "convertirlos" a CDMX.
- Los filtros por fecha (`YYYY-MM-DD`) representan días civiles de `America/Mexico_City`.
- El frontend administrativo debe usar `Intl.DateTimeFormat(..., { timeZone: 'America/Mexico_City' })`.
- No usar `23:59:59.999Z` para cerrar un día de CDMX; usar el inicio exclusivo del día siguiente.

---

## 2. Desarrollo Local

1. Instalar dependencias: `npm install`
2. Levantar el entorno de Vercel: `vercel dev`
3. Abrir `http://localhost:3000`

---

## Seguridad y Privacidad

- **NIP**: No se persiste en la base de datos por normativa de seguridad. Si coincide con los últimos 4 dígitos del
  teléfono, se exige una fecha de vigencia (hoy..hoy+5 días, CDMX) que tampoco se persiste.
- **Email**: se captura para el envío futuro del cupón BAIT (Stage 1I). Requerido para leads nuevos; `NULL` en leads
  históricos.
- **CAPTCHA**: generado y validado 100% en el servidor (`api/captcha/challenge.js`, `lib/captcha.js`). Solo se
  persiste un hash HMAC-SHA256 de la respuesta (`CAPTCHA_PEPPER`), nunca el texto plano; cada challenge es de un solo uso.
- **Aviso de Privacidad**: página estática en `/aviso-de-privacidad/`. Contenido legal pendiente de datos reales —
  ver `docs/legal/privacy-required-inputs.md`.
- **Preview Safety**: Los despliegues preview (rama no principal) o locales no deben afectar la base de datos de producción.

## UTMs y Atribución

Soporte completo para captura de: `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `gclid`, `fbclid`, `fb_ad_id`, `fb_adset_id`, `fb_campaign_id`.
