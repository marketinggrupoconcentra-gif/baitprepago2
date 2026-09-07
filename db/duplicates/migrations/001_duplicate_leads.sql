-- ⚡
-- BAIT Prepago 2 - Migration 001 for DUPLICATES
-- Base de datos: Neon PostgreSQL (Segunda base de datos lógica)
-- Zona horaria de negocio: America/Mexico_City
-- ⚡

SET TIME ZONE 'America/Mexico_City';

CREATE TABLE IF NOT EXISTS duplicate_leads (
  id                      SERIAL          PRIMARY KEY,
  created_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  
  -- The unique phone that triggered the duplicate
  phone                   VARCHAR(10)     NOT NULL,
  
  -- Secondary metadata
  email                   TEXT,
  duplicate_of_lead_id    BIGINT,
  reason                  VARCHAR(128)    NOT NULL DEFAULT 'PHONE_ALREADY_EXISTS',
  
  -- UTM parameters
  utm_source              VARCHAR(255),
  utm_medium              VARCHAR(255),
  utm_campaign            VARCHAR(255),
  utm_content             VARCHAR(255),
  utm_term                VARCHAR(255),
  
  -- Meta / Facebook Ads parameters
  fbclid                  VARCHAR(512),
  fb_ad_id                VARCHAR(255),
  fb_adset_id             VARCHAR(255),
  fb_campaign_id          VARCHAR(255),
  
  -- Request metadata
  ip                      VARCHAR(45),
  user_agent              TEXT,
  referrer                TEXT,
  page_url                TEXT
);

CREATE INDEX IF NOT EXISTS duplicate_leads_created_at_idx ON duplicate_leads (created_at DESC);
CREATE INDEX IF NOT EXISTS duplicate_leads_phone_idx ON duplicate_leads (phone);
CREATE INDEX IF NOT EXISTS duplicate_leads_email_idx ON duplicate_leads (email);
CREATE INDEX IF NOT EXISTS duplicate_leads_utm_source_idx ON duplicate_leads (utm_source);
CREATE INDEX IF NOT EXISTS duplicate_leads_utm_campaign_idx ON duplicate_leads (utm_campaign);
