# BAIT Prepago 2

## Arquitectura

- **Frontend**: HTML/JS/CSS estático
- **Backend**: Vercel Serverless Functions (`api/leads.js`)
- **Base de Datos**: Neon PostgreSQL

## Requisitos

- Node.js 18+
- Cuenta en [Neon](https://neon.tech)
- Vercel CLI (`npm i -g vercel`)

---

## 1. Configuración de Base de Datos

1. Crear proyecto en Neon.
2. Linkear Neon a Vercel con la integración oficial. Vercel inyectará `POSTGRES_URL` o `DATABASE_URL` de manera segura.
3. Ejecutar las migraciones: `npm run db:migrate`

---

## 2. Desarrollo Local

1. Instalar dependencias: `npm install`
2. Levantar el entorno de Vercel: `vercel dev`
3. Abrir `http://localhost:3000`

---

## Seguridad y Privacidad

- **NIP**: No se persiste en la base de datos por normativa de seguridad.
- **Preview Safety**: Los despliegues preview (rama no principal) o locales no deben afectar la base de datos de producción.

## UTMs y Atribución

Soporte completo para captura de: `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `gclid`, `fbclid`, `fb_ad_id`, `fb_adset_id`, `fb_campaign_id`.
