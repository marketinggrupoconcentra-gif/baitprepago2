-- Migration 007: Password Resets

CREATE TABLE IF NOT EXISTS admin_password_resets (
    id SERIAL PRIMARY KEY,
    admin_user_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_password_resets_token_hash ON admin_password_resets(token_hash);
CREATE INDEX IF NOT EXISTS idx_admin_password_resets_user_id ON admin_password_resets(admin_user_id);
