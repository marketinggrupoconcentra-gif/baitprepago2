-- ─────────────────────────────────────────────────────────────────
--  BAIT Prepago 2 — Schema de base de datos
--  Base de datos: Neon PostgreSQL (Conectada vía Vercel)
-- ─────────────────────────────────────────────────────────────────

-- Tabla principal de leads del formulario de portabilidad
CREATE TABLE IF NOT EXISTS leads (
  id              SERIAL          PRIMARY KEY,
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

  -- Datos del formulario (NIP se valida en server y se descarta)
  phone           VARCHAR(10)     NOT NULL,

  -- ── UTMs de Google Ads / GA4 ──────────────────────────────────
  utm_source      VARCHAR(255),
  utm_medium      VARCHAR(255),
  utm_campaign    VARCHAR(255),
  utm_content     VARCHAR(255),
  utm_term        VARCHAR(255),

  -- ── Parámetros de Meta / Facebook Ads ────────────────────────
  fbclid          VARCHAR(512),
  fb_ad_id        VARCHAR(255),
  fb_adset_id     VARCHAR(255),
  fb_campaign_id  VARCHAR(255),

  -- ── Metadatos del request ─────────────────────────────────────
  ip              VARCHAR(45),
  user_agent      TEXT,
  referrer        TEXT,
  page_url        TEXT,

  -- ── Workflow Status ───────────────────────────────────────────
  status            VARCHAR(32)     NOT NULL DEFAULT 'NEW',
  status_reason     VARCHAR(64),
  status_updated_at TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  status_version    INTEGER         NOT NULL DEFAULT 1,
  
  CONSTRAINT leads_status_version_check CHECK (status_version > 0),
  CONSTRAINT leads_status_check CHECK (
      status IN (
          'NEW', 'VALIDATED', 'CONTACT_PENDING', 'CONTACTED', 
          'SIM_PENDING', 'SIM_READY', 'ACTIVATION_PENDING', 
          'ACTIVATED', 'PORTABILITY_PENDING', 'COMPLETED', 
          'REJECTED', 'CANCELLED'
      )
  ),
  CONSTRAINT leads_status_reason_rule CHECK (
      (status IN ('REJECTED', 'CANCELLED') AND status_reason IS NOT NULL) OR
      (status NOT IN ('REJECTED', 'CANCELLED') AND status_reason IS NULL)
  )
);

-- Índices para consultas frecuentes (incluyendo los de idempotencia y rate limiting)
CREATE INDEX IF NOT EXISTS leads_created_at_idx  ON leads (created_at DESC);
CREATE INDEX IF NOT EXISTS leads_phone_idx        ON leads (phone);
CREATE INDEX IF NOT EXISTS leads_ip_idx           ON leads (ip);
CREATE INDEX IF NOT EXISTS leads_utm_source_idx   ON leads (utm_source);
CREATE INDEX IF NOT EXISTS leads_utm_campaign_idx ON leads (utm_campaign);
CREATE INDEX IF NOT EXISTS leads_fbclid_idx       ON leads (fbclid);
CREATE INDEX IF NOT EXISTS leads_status_created_at_idx ON leads (status, created_at DESC, id DESC);
