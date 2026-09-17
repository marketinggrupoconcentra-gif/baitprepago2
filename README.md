# BAIT Prepago 2

## 📚 Documentación técnica y auditoría

La documentación detallada de configuración por módulo, stack técnico completo, flujo de trabajo y grafo de conexiones vive en un **vault de Obsidian** en [`docs/`](./docs/):

- [`docs/Home.md`](./docs/Home.md) — punto de entrada del vault (mapa de contenidos).
- [`docs/00-Auditoria-Tecnica.md`](./docs/00-Auditoria-Tecnica.md) — auditoría completa del repositorio.
- [`docs/01-Stack-Tecnico.md`](./docs/01-Stack-Tecnico.md) — stack tecnológico autorizado.
- [`docs/02-Flujo-de-Trabajo.md`](./docs/02-Flujo-de-Trabajo.md) — flujo de desarrollo detallado (local → preview → producción).
- [`docs/03-Variables-de-Entorno.md`](./docs/03-Variables-de-Entorno.md) — inventario de variables de entorno (sin valores/secretos).
- [`docs/04-Indice-de-Funciones.md`](./docs/04-Indice-de-Funciones.md) — catálogo de funciones por módulo, para no duplicar lógica.
- [`docs/modules/`](./docs/modules/) — una nota por módulo (frontend, API, lib, DB, scripts, tests).
- [`docs/graph/architecture.md`](./docs/graph/architecture.md) — diagramas Mermaid de arquitectura y grafo de dependencias.

> Abre la carpeta `docs/` como vault en Obsidian para navegar por enlaces y usar el Graph View — así se visualiza qué módulos/funciones ya existen antes de crear nuevos, evitando duplicaciones.
>
> Las reglas de negocio no negociables (stack cerrado, PII/NIP, zona horaria CDMX) siguen siendo autoritativas en [`GEMINI.md`](./GEMINI.md); este vault las referencia y las amplía con detalle operativo.

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

- **NIP**: No se persiste en la base de datos por normativa de seguridad.
- **Preview Safety**: Los despliegues preview (rama no principal) o locales no deben afectar la base de datos de producción.

## UTMs y Atribución

Soporte completo para captura de: `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `gclid`, `fbclid`, `fb_ad_id`, `fb_adset_id`, `fb_campaign_id`.
