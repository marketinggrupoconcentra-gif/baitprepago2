/**
 * src/lib/security/privilege-manifest.ts
 *
 * Version-controlled runtime privilege manifest for baitprepago_app_runtime.
 * Defines explicit per-table SELECT/INSERT/UPDATE/DELETE permissions.
 *
 * Every table in the app schema MUST have an entry here.
 * A test enforces that actual grants match this manifest AND that
 * no table exists in app schema without a manifest entry (§41-42).
 */

export type TablePrivileges = {
  select: boolean;
  insert: boolean;
  update: boolean;
  delete: boolean;
};

/**
 * The authoritative privilege manifest for baitprepago_app_runtime.
 * Key = table name in app schema (without schema prefix).
 *
 * Rationale for each table's privileges is documented inline.
 */
export const PRIVILEGE_MANIFEST: Record<string, TablePrivileges> = {
  // ── Lead Pipeline ───────────────────────────────────────────────────────────
  leads: {
    select: true,   // read for dedup, export, admin list
    insert: true,   // create lead in atomic tx
    update: true,   // cambios de estado técnico desde el admin
    delete: false,   // leads are never deleted at runtime
  },
  lead_secrets: {
    select: true,   // read NIP for verification
    insert: true,   // create with lead in atomic tx
    update: false,  // immutable after creation
    delete: true,   // NIP purge cron (nip-purge route)
  },
  lead_attribution: {
    select: true,   // read for export, analytics
    insert: true,   // create with lead in atomic tx
    update: false,  // immutable after creation
    delete: false,
  },
  lead_consents: {
    select: true,   // read for export, compliance
    insert: true,   // create with lead in atomic tx
    update: false,  // immutable legal record
    delete: false,
  },
  idempotency_keys: {
    select: true,   // check for duplicates
    insert: true,   // reserve in atomic tx
    update: false,  // immutable after creation
    delete: false,
  },

  // ── Conversiones a plataformas de anuncios ──────────────────────────────────
  conversion_deliveries: {
    select: true,   // cron: filas pendientes; admin: conteos
    insert: true,   // encolar (tx del lead, cambio a Ganado)
    update: true,   // estado/reintentos desde el cron
    delete: false,
  },

  // ── CAPTCHA propio de la landing ────────────────────────────────────────────
  captcha_challenges: {
    select: true,   // consume: leer answer_hash/expires_at/used_at
    insert: true,   // emitir reto (POST /api/captcha/challenge)
    update: true,   // marcar used_at (single-use, atómico)
    delete: true,   // purga de retos vencidos (cron nip-purge)
  },

  // ── Rate Limiting ───────────────────────────────────────────────────────────
  rate_limits: {
    select: true,   // check current count
    insert: true,   // create new window entry
    update: true,   // increment counter (UPSERT)
    delete: true,   // cleanup expired entries
  },

  // ── Security (append-only) ──────────────────────────────────────────────────
  security_events: {
    select: false,  // write-only audit trail
    insert: true,   // log security events
    update: false,
    delete: false,
  },
  audit_logs: {
    select: false,  // write-only audit trail
    insert: true,   // log admin actions
    update: false,
    delete: false,
  },

  // ── Analytics ───────────────────────────────────────────────────────────────
  analytics_events: {
    select: true,   // read for admin analytics
    insert: true,   // log events
    update: false,  // immutable after creation
    delete: false,
  },

  // ── Admin ───────────────────────────────────────────────────────────────────
  admin_profiles: {
    select: true,   // read profile for RBAC, session
    insert: true,   // create profile on bootstrap
    update: true,   // update role, preferences
    delete: false,  // admin profiles are soft-deleted or retained
  },
  lead_management: {
    select: true,   // read management state
    insert: true,   // create management record
    update: true,   // status transitions
    delete: false,
  },

  // ── Reports ─────────────────────────────────────────────────────────────────
  report_schedules: {
    select: true,   // list schedules
    insert: true,   // create schedule
    update: false,  // immutable (recreate instead)
    delete: false,
  },
  report_runs: {
    select: true,   // list runs, check status
    insert: true,   // create run record
    update: true,   // update status on completion
    delete: false,
  },
  ads_metrics: {
    select: true,
    insert: true,
    update: true,
    delete: false,
  },
  settings: {
    select: true,
    insert: true,
    update: true,
    delete: false,
  },
};
