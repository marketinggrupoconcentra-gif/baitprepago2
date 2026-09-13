# Runtime DB role — least privilege (SEC-010)

**Regla del proyecto:** los roles PostgreSQL de *runtime* de BAIT Prepago se crean
**vía SQL** (ejecutado por el rol owner/migración), **nunca** vía Neon
Console / CLI / API / MCP `create_postgres_role`. Los roles creados por esas vías
reciben automáticamente membresía en `neon_superuser` (createdb/createrole/
replication/bypassrls + lectura de `neon_auth`), lo que rompe el mínimo
privilegio. Un rol creado por SQL se comporta como un rol PostgreSQL normal.

## Rol actual

- **`baitprepago_app_runtime`** — creado vía SQL (`scripts/provision-runtime-role.mjs`). `NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOINHERIT NOREPLICATION NOBYPASSRLS`. Sin membresías. Sin acceso a `neon_auth`
  (identidad/sesión se resuelven por el SDK de Neon Auth por HTTP, nunca por DB).
- `APP_DATABASE_URL` (Vercel production + preview) = `baitprepago_app_runtime`.
- `DATABASE_URL` = rol owner/migración (`neondb_owner`). **Solo** migraciones y
  tooling admin. **Ausente** del runtime en Vercel. `src/db/index.ts` hace
  fail-closed en producción si falta `APP_DATABASE_URL` (no cae a `DATABASE_URL`).

## Plantilla de creación (sin secreto)

```sql
-- como neondb_owner (DATABASE_URL):
CREATE ROLE baitprepago_app_runtime WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD '<CSPRNG >=32 bytes base64url>';

GRANT CONNECT ON DATABASE neondb TO baitprepago_app_runtime;
GRANT USAGE ON SCHEMA app TO baitprepago_app_runtime;   -- NUNCA GRANT CREATE
```

## Matriz de privilegios (derivada del source, no de comodidad)

| Tabla (`app.`)         | SELECT | INSERT | UPDATE | DELETE | Justificación |
|------------------------|:---:|:---:|:---:|:---:|---|
| leads                  | ✔ | ✔ | ✔ |   | alta (tx lead), dedup, listados admin, dashboard/reportes, cambios de estado desde el admin |
| lead_secrets           | ✔ | ✔ |   | ✔ | (vacía en BAIT Prepago: el NIP no se persiste) insert (tx lead), delete (cron). Sin UPDATE |
| lead_attribution       | ✔ | ✔ |   |   | insert (tx lead), joins de reportes/dashboard/admin |
| lead_consents          | ✔ | ✔ |   |   | insert (tx lead), detalle de lead en admin |
| idempotency_keys       | ✔ | ✔ |   |   | SELECT (check idempotencia) + INSERT ... RETURNING (`onConflictDoNothing`). Sin UPDATE |
| analytics_events       | ✔ | ✔ |   |   | insert (`/api/track`, `lead_success`), lecturas de analítica/funnel |
| security_events        |   | ✔ |   |   | append-only (`logSecurityEvent`). SELECT denegado |
| admin_profiles         | ✔ | ✔ | ✔ |   | autorización (session), alta/edición de usuarios y bootstrap. Baja lógica vía `is_active` |
| audit_logs             |   | ✔ |   |   | append-only (`writeAuditLog`). SELECT denegado |
| lead_management        | ✔ | ✔ | ✔ |   | joins admin + upsert de estado comercial |
| report_schedules       | ✔ | ✔ |   |   | SELECT (cron + listado admin) + INSERT ... RETURNING |
| report_runs            | ✔ | ✔ | ✔ |   | dedup, INSERT, UPDATE de estado (SENT/FAILED) |
| captcha_challenges     | ✔ | ✔ | ✔ | ✔ | emitir (INSERT), consumir (UPDATE ... WHERE used_at IS NULL RETURNING), purga (DELETE) |
| rate_limits            | ✔ | ✔ | ✔ | ✔ | `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`, purga (DELETE ... WHERE) |

`SELECT` acompaña a `UPDATE`/`DELETE` cuando el `WHERE`/`RETURNING` referencia
columnas (requisito de PostgreSQL), y a `INSERT` cuando hay `RETURNING`.

## Verificación

`tests/integration/etapa22.test.ts` → describe `SEC-010 rol runtime de mínimo privilegio`
(requiere `APP_RUNTIME_DATABASE_URL` apuntando al rol). Comprueba:
`pg_has_role(...,'neon_superuser','member') = false`, los 5 atributos en `false`,
CREATE/ALTER/DROP/CREATE ROLE denegados, `neon_auth` con acceso **efectivo**
denegado, y que el DML requerido funciona (incluido el driver transaccional Pool/WS).
