-- Migration 002: Admin Authentication Baseline
-- Idempotent / additive — safe for fresh environments and repeated execution.
-- Does NOT contain DROP, TRUNCATE, or CASCADE destructive operations.
-- Running this migration 1 or N times produces the same schema without data loss.

-- ── Admin Users ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_users (
  id           SERIAL PRIMARY KEY,
  email        VARCHAR(255) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role         VARCHAR(50) NOT NULL DEFAULT 'VIEWER'
    CONSTRAINT admin_users_role_check CHECK (role IN ('SUPER_ADMIN','ADMIN','EDITOR','VIEWER')),
  active       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at TIMESTAMP WITH TIME ZONE
);

-- ── Admin Sessions ────────────────────────────────────────────────────────────
-- token_hash stores SHA-256 of the opaque session token — never the plaintext.
CREATE TABLE IF NOT EXISTS admin_sessions (
  id            SERIAL PRIMARY KEY,
  admin_user_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL UNIQUE,
  created_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at    TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE INDEX IF NOT EXISTS admin_sessions_admin_user_id_idx ON admin_sessions(admin_user_id);
CREATE INDEX IF NOT EXISTS admin_sessions_expires_at_idx    ON admin_sessions(expires_at);

-- ── Admin Login Attempts (Rate Limiting) ──────────────────────────────────────
-- kind = 'IP'      → key_hash is HMAC(pepper, client IP)
-- kind = 'ACCOUNT' → key_hash is HMAC(pepper, email)
CREATE TABLE IF NOT EXISTS admin_login_attempts (
  id               SERIAL PRIMARY KEY,
  key_hash         TEXT NOT NULL,
  kind             VARCHAR(50) NOT NULL
    CONSTRAINT admin_login_attempts_kind_check CHECK (kind IN ('IP','ACCOUNT')),
  attempts         INTEGER NOT NULL DEFAULT 1,
  window_started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_attempt_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_until     TIMESTAMP WITH TIME ZONE,
  CONSTRAINT admin_login_attempts_kind_key_hash_unique UNIQUE (kind, key_hash)
);

CREATE INDEX IF NOT EXISTS admin_login_attempts_kind_key_hash_idx
  ON admin_login_attempts(kind, key_hash);
CREATE INDEX IF NOT EXISTS admin_login_attempts_locked_until_idx
  ON admin_login_attempts(locked_until) WHERE locked_until IS NOT NULL;

-- ── Admin Audit Log ───────────────────────────────────────────────────────────
-- actor_hash is HMAC(pepper, identity) — never raw IP or email.
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id            SERIAL PRIMARY KEY,
  admin_user_id INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
  action        VARCHAR(255) NOT NULL,
  actor_hash    TEXT NOT NULL,
  metadata      JSONB,
  created_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS admin_audit_log_admin_user_id_idx
  ON admin_audit_log(admin_user_id);
CREATE INDEX IF NOT EXISTS admin_audit_log_created_at_idx
  ON admin_audit_log(created_at DESC);
