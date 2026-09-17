---
tags: [stack, bait-prepago]
---

# Stack Tecnológico

Ver también: [[Home]] · [[00-Auditoria-Tecnica]] · [[02-Flujo-de-Trabajo]]

## Resumen ejecutivo

| Capa | Tecnología | Dónde vive |
|---|---|---|
| Frontend público | HTML + CSS + JS vanilla (sin frameworks, sin build step) | `index.html`, `assets/site.css`, `assets/site.js`, `gracias/`, `walmart-beneficios/` |
| Frontend admin | HTML + CSS + JS vanilla, módulos ES nativos, sin librerías externas | `admin/*.html`, `admin/*.css`, `admin/*.js`, `assets/admin-leads.js` |
| Backend / API | Vercel Serverless Functions (Node.js, formato `export default handler(req,res)`) | `api/**/*.js` |
| Librerías compartidas | Módulos ES (`lib/*.js`) importados por las funciones serverless | `lib/` |
| Base de datos | Neon PostgreSQL (serverless, driver `@neondatabase/serverless`) | `db/schema.sql`, `db/migrations/`, `.neon` |
| Hosting / CI-CD | Vercel (`vercel.json`, `.vercel/project.json`) | raíz del repo |
| Testing | Node.js test runner nativo (`node --test`) + scripts custom en `tests/` | `tests/` |
| Automatización local | Neon config declarativo (`neon.ts`) + función de ejemplo (`hello.ts`) | raíz del repo |

## Dependencias declaradas (`package.json`)

- **Producción**: `@neondatabase/serverless` — único cliente de base de datos permitido; expone tanto template-tag SQL (``sql`...` ``) como `sql.query(text, params)` para SQL dinámico parametrizado.
- **Desarrollo**: `playwright` (pruebas end-to-end de navegador), `vercel` (CLI de despliegue/dev server).
- No hay framework de frontend (React/Vue/etc.), no hay bundler/transpilador, no hay ORM. Es una decisión de arquitectura explícita: **menor superficie de ataque y cero dependencias de build**.

## Reglas de stack cerrado (obligatorias)

Documentadas de forma autoritativa en `GEMINI.md` (raíz del repo), sección "Stack Tecnológico Autorizado":

> Queda estrictamente prohibido utilizar o configurar servicios alternativos de terceros como: Cloudflare, Cloudflare Pages, Cloudflare Workers, Supabase, Firebase, Redis, WorkOS, Auth0, Clerk, Resend, etc. El stack es exclusivo de Vercel y Neon.

Cualquier auditoría o cambio futuro debe verificar que esta regla se mantenga antes de introducir una nueva dependencia.

## Runtime de API (Vercel Serverless Functions)

- Cada archivo en `api/` (y subcarpetas) es una función independiente; Vercel enruta por convención de carpetas (`api/admin/leads/status.js` → `POST/PATCH /api/admin/leads/status`).
- Patrón común en cada handler:
  1. Cabeceras de seguridad (`Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow`).
  2. Validación de método HTTP.
  3. Validación de `Content-Type` y tamaño de payload cuando aplica.
  4. `assertSameOrigin(req)` en mutaciones sensibles (CSRF ligero basado en cabecera `Origin`).
  5. `requireAdminSession(req, res)` como *guard* de autenticación centralizado (rutas de `api/admin/*`, excepto `login`).
  6. Verificación de rol vía `hasRole()` (RBAC).
  7. Acceso a datos vía `getDb()` (singleton Neon) — plantillas SQL con placeholders o `sql.query()` parametrizado (nunca concatenación de strings de usuario).
  8. Respuesta JSON con *allowlist* explícito de campos (nunca `SELECT *` expuesto directo al cliente).
- `export const config = { api: { bodyParser: false | true | { sizeLimit } } }` se usa por archivo para controlar el parseo de body cuando el handler necesita leer manualmente o limitar tamaño.

## Base de datos (Neon PostgreSQL)

- Conexión resuelta por `lib/db.js::resolveDatabaseUrl()` con fallback en orden: `DATABASE_URL` → `POSTGRES_URL` → `STORAGE_DATABASE_URL` (variables inyectadas automáticamente por la integración Vercel↔Neon).
- Cliente HTTP serverless (`neon()`), instanciado una sola vez por *cold start* (`sqlInstance` singleton) para evitar overhead de conexión en cada invocación.
- Zona horaria de negocio fijada a nivel de base de datos y rol (`ALTER DATABASE ... SET TimeZone`, migración `004_cdmx_timezone_policy.sql`), con un *guardrail* SQL que aborta la migración si detecta columnas `timestamp without time zone` en el esquema público.
- `.neon` (raíz) guarda metadatos de vinculación del proyecto Neon (organización/proyecto/rama) usados por la integración con Vercel; **no contiene credenciales**.
- `neon.ts` es configuración declarativa del *toolkit* Neon (política de expiración de ramas de preview a 7 días, definición de una función de ejemplo `hello.ts`) — infraestructura como código para el ciclo de vida de branches de base de datos, independiente del runtime de la app.

## Hosting y despliegue (Vercel)

- `vercel.json` define, por ruta:
  - Cabeceras de seguridad globales (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`).
  - `noindex` condicional para el dominio de *preview* (`baitprepago2.vercel.app`).
  - `Cache-Control: no-store` para `/api/*` y `/admin/*`.
  - Cache agresivo e inmutable para `/assets/*`.
  - **Content-Security-Policy** estricta en `/admin` y `/admin/:path*`: `script-src 'self'`, `style-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, sin ningún dominio externo permitido — coherente con la regla de "sin librerías externas" en el panel admin.
  - `Permissions-Policy` deshabilita cámara, micrófono y geolocalización en el panel admin.
- `cleanUrls: true` elimina la extensión `.html` de las URLs servidas.
- `.vercel/project.json` (gitignored) contiene el enlace local proyecto↔Vercel; no se documenta su contenido por ser un identificador de infraestructura.

## Testing

- `npm test` encadena: fundamentos → auth → dashboard (unit) → leads (unit) → workflow (unit) → analytics (unit) → resolución de entorno de DB → política de timezone.
- Pruebas de integración (`*-integration.js`) y E2E de navegador (`*-e2e.js`, con Playwright) requieren credenciales de una rama de base de datos de prueba, cargadas vía `--env-file=.env.branch` (nunca commiteado).
- `tests/db-env-resolution.test.js` y `tests/timezone-policy.test.js` usan el *test runner* nativo de Node (`node --test`).

Ver el detalle módulo por módulo en [[00-Auditoria-Tecnica]] y el catálogo de funciones en [[04-Indice-de-Funciones]].
