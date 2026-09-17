---
tags: [moc, bait-prepago]
---

# 🏠 BAIT Prepago 2 — Vault de Documentación Técnica

Este vault (carpeta `docs/`) es la base de conocimiento persistente del proyecto **BAIT Prepago 2**, pensada para abrirse con **Obsidian** y navegarse mediante enlaces `[[wikilink]]` y el **Graph View** nativo, sin perder contexto entre sesiones de trabajo (humanas o de agentes de IA).

> [!INFO] Cómo usar este vault
> 1. Abre la carpeta `docs/` como *vault* en Obsidian (ya trae `.obsidian/` configurado).
> 2. Usa el panel **Graph** para ver visualmente cómo se conectan páginas, APIs, librerías compartidas y base de datos — así se evita duplicar módulos o funciones ya existentes.
> 3. Antes de crear una función nueva, revisa [[04-Indice-de-Funciones]] para confirmar que no exista ya un helper equivalente.
> 4. Las reglas de negocio **no negociables** (stack autorizado, PII/NIP, zona horaria CDMX) viven en `GEMINI.md` en la raíz del repo — este vault las referencia pero no las reemplaza.

## Mapa de contenidos

### Documentos raíz
- [[00-Auditoria-Tecnica]] — auditoría completa: qué existe, dónde vive la configuración de cada módulo/elemento/función, y hallazgos.
- [[01-Stack-Tecnico]] — stack tecnológico autorizado, versiones y por qué se eligió cada pieza.
- [[02-Flujo-de-Trabajo]] — flujo de desarrollo local → preview → producción, comandos de `npm`, migraciones, pruebas.
- [[03-Variables-de-Entorno]] — inventario de variables de entorno usadas por el sistema (**sin valores, sin secretos**).
- [[04-Indice-de-Funciones]] — catálogo de funciones exportadas por módulo, para evitar reimplementar lógica ya existente.

### Módulos (carpeta `modules/`)
- [[modules/frontend-landing]] — landing pública (`index.html`, `assets/site.js`, `gracias/`, `walmart-beneficios/`).
- [[modules/frontend-admin-panel]] — panel administrativo (`admin/*.html`, `admin/*.js`, `admin/*.css`).
- [[modules/api-publico-leads]] — endpoint público de captura de leads (`api/leads.js`).
- [[modules/api-admin-auth]] — autenticación, sesión y logout del admin (`api/admin/login.js`, `logout.js`, `session.js`).
- [[modules/api-admin-dashboard-analytics]] — overview y analítica (`api/admin/overview.js`, `api/admin/analytics/*`).
- [[modules/api-admin-leads]] — gestión de leads en el panel (`api/admin/leads/*`).
- [[modules/api-admin-usuarios]] — gestión de usuarios admin y contraseña (`api/admin/users/*`, `api/admin/settings/password.js`).
- [[modules/lib-compartida]] — librerías compartidas server-side (`lib/*.js`).
- [[modules/base-de-datos]] — esquema Neon PostgreSQL y migraciones (`db/`).
- [[modules/scripts-operacion]] — scripts operativos/QA (`scripts/`).
- [[modules/tests]] — suite de pruebas (`tests/`).

### Grafo de arquitectura (carpeta `graph/`)
- [[graph/architecture]] — diagramas Mermaid: flujo público de leads, flujo del panel admin y grafo de dependencias de `lib/`.

## Reglas de oro heredadas de `GEMINI.md`

- **Stack cerrado**: solo Vercel + Neon PostgreSQL. Prohibido introducir Cloudflare, Supabase, Firebase, Redis, Auth0, Clerk, Resend, etc.
- **PII/NIP**: el NIP nunca se persiste ni viaja por URL. Los teléfonos se enmascaran en todas las vistas de listado (`maskPhone`) y solo se revelan mediante un endpoint auditado y restringido a `SUPER_ADMIN`.
- **Zona horaria de negocio**: `America/Mexico_City` en DB, backend y frontend — nunca se desplazan timestamps históricos.
- **Fail-closed**: ante cualquier ambigüedad de entorno (preview vs. producción, timezone no confirmada), los scripts deben abortar en vez de continuar.

## Convenciones de este vault

- Cada nota de módulo declara `tags` en el frontmatter (`#modulo/frontend`, `#modulo/api`, `#modulo/lib`, `#modulo/db`, `#modulo/scripts`, `#modulo/tests`) para poder agrupar por color en el Graph View.
- Los nombres de archivo usan prefijos numéricos (`00-`, `01-`...) solo en los documentos raíz para fijar un orden de lectura sugerido; las notas de `modules/` no lo necesitan porque se navegan por el grafo, no linealmente.
- **Nunca** se documentan contraseñas, tokens, connection strings completos ni URLs de infraestructura (endpoints de Neon, IDs de proyecto/rama) — solo los **nombres** de las variables de entorno que los contienen. Ver [[03-Variables-de-Entorno]].
