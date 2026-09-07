-- Migration 006: Resend Outbox, Invitations and Reports
-- Idempotent / additive — safe for fresh environments and repeated execution.

-- ── Admin Invitations ────────────────────────────────────────────────────────
-- token_hash stores SHA-256 of the opaque invitation token.
CREATE TABLE IF NOT EXISTS admin_invitations (
  id            SERIAL PRIMARY KEY,
  token_hash    TEXT NOT NULL UNIQUE,
  email         VARCHAR(255) NOT NULL,
  role          VARCHAR(50) NOT NULL
    CONSTRAINT admin_invitations_role_check CHECK (role IN ('SUPER_ADMIN','ADMIN','EDITOR','VIEWER')),
  status        VARCHAR(50) NOT NULL DEFAULT 'PENDING'
    CONSTRAINT admin_invitations_status_check CHECK (status IN ('PENDING', 'ACCEPTED', 'REVOKED')),
  created_by    INTEGER NOT NULL REFERENCES admin_users(id),
  accepted_by   INTEGER REFERENCES admin_users(id),
  created_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at    TIMESTAMP WITH TIME ZONE NOT NULL,
  CONSTRAINT admin_invitations_email_role_unique UNIQUE (email, role, status)
);

CREATE INDEX IF NOT EXISTS admin_invitations_email_idx ON admin_invitations(email);
CREATE INDEX IF NOT EXISTS admin_invitations_expires_at_idx ON admin_invitations(expires_at);

-- ── Email Outbox ─────────────────────────────────────────────────────────────
-- Durable queue for outgoing emails via Resend.
CREATE TABLE IF NOT EXISTS email_outbox (
  id               SERIAL PRIMARY KEY,
  idempotency_key  VARCHAR(255) NOT NULL UNIQUE,
  recipient        VARCHAR(255) NOT NULL,
  subject          VARCHAR(255) NOT NULL,
  html_body        TEXT NOT NULL,
  text_body        TEXT,
  template_type    VARCHAR(50) NOT NULL, -- e.g., 'INVITATION', 'REPORT', 'COUPON'
  status           VARCHAR(50) NOT NULL DEFAULT 'QUEUED'
    CONSTRAINT email_outbox_status_check CHECK (status IN ('QUEUED', 'PROCESSING', 'SENT', 'DELIVERED', 'FAILED', 'RETRY', 'SUPPRESSED', 'CANCELLED', 'BLOCKED_CONFIGURATION')),
  intent_count     INTEGER NOT NULL DEFAULT 0,
  provider_id      VARCHAR(255), -- Resend message ID
  error_message    TEXT,
  lease_until      TIMESTAMP WITH TIME ZONE,
  created_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS email_outbox_status_idx ON email_outbox(status);
CREATE INDEX IF NOT EXISTS email_outbox_lease_until_idx ON email_outbox(lease_until);
CREATE INDEX IF NOT EXISTS email_outbox_provider_id_idx ON email_outbox(provider_id);

-- ── Email Delivery Events (Webhook Audit) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_delivery_events (
  id               SERIAL PRIMARY KEY,
  provider_id      VARCHAR(255) NOT NULL,
  event_type       VARCHAR(100) NOT NULL,
  event_payload    JSONB,
  created_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS email_delivery_events_provider_id_idx ON email_delivery_events(provider_id);

-- ── Email Suppressions ───────────────────────────────────────────────────────
-- Hard bounces, complaints, etc. Prevent sending to these addresses again.
CREATE TABLE IF NOT EXISTS email_suppressions (
  id            SERIAL PRIMARY KEY,
  email         VARCHAR(255) NOT NULL UNIQUE,
  reason        VARCHAR(100) NOT NULL,
  created_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS email_suppressions_email_idx ON email_suppressions(email);

-- ── Report Schedules ─────────────────────────────────────────────────────────
-- Automated reports configuration
CREATE TABLE IF NOT EXISTS report_schedules (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(255) NOT NULL,
  frequency     VARCHAR(50) NOT NULL -- 'DAILY', 'WEEKLY', 'MONTHLY'
    CONSTRAINT report_schedules_freq_check CHECK (frequency IN ('DAILY', 'WEEKLY', 'MONTHLY')),
  recipient_ids JSONB NOT NULL, -- Array of admin_user_ids
  status        VARCHAR(50) NOT NULL DEFAULT 'PAUSED'
    CONSTRAINT report_schedules_status_check CHECK (status IN ('ACTIVE', 'PAUSED')),
  next_run_at   TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS report_schedules_next_run_at_idx ON report_schedules(next_run_at);

-- ── Report Runs ──────────────────────────────────────────────────────────────
-- History of generated reports
CREATE TABLE IF NOT EXISTS report_runs (
  id                 SERIAL PRIMARY KEY,
  report_schedule_id INTEGER REFERENCES report_schedules(id) ON DELETE SET NULL,
  period_start       TIMESTAMP WITH TIME ZONE NOT NULL,
  period_end         TIMESTAMP WITH TIME ZONE NOT NULL,
  generated_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status             VARCHAR(50) NOT NULL DEFAULT 'GENERATED'
    CONSTRAINT report_runs_status_check CHECK (status IN ('GENERATED', 'FAILED'))
);

CREATE INDEX IF NOT EXISTS report_runs_schedule_id_idx ON report_runs(report_schedule_id);
