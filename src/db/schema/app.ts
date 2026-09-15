import { pgSchema, uuid, text, timestamp, boolean, integer, jsonb, index, uniqueIndex, smallint, primaryKey, varchar, bigint, date, numeric } from 'drizzle-orm/pg-core';

// ── Schema propio — NO tocar neon_auth ────────────────────────────────────────
export const app = pgSchema('app');

// ── Enums ─────────────────────────────────────────────────────────────────────
export const leadStatusEnum = app.enum('lead_status', [
  'received',
  'processing',
  'delivered',
  'failed',
  'duplicate',
]);

export const sourceCategoryEnum = app.enum('source_category', [
  'google_ads',
  'meta_ads',
  'paid_other',
  'organic',
  'referral',
  'direct',
  'other',
]);

export const outboxStatusEnum = app.enum('outbox_status', [
  'pending',
  'processing',
  'delivered',
  'failed',
  'dead',
]);

export const securityEventTypeEnum = app.enum('security_event_type', [
  'bot_block',
  'honeypot',
  'rate_limit',
  'invalid_origin',
  'oversized_body',
  'schema_rejection',
  'replay',
  'duplicate',
  'otp_failure',
  'auth_failure',
  'suspicious_request',
]);

// ─────────────────────────────────────────────────────────────────────────────
// app.leads — Lead principal con PII cifrada
// Datos sensibles: first_name_enc, last_name_enc, email_enc, phone_enc,
// birthdate_enc usan AES-256-GCM (application-level encryption).
// Blind indexes (_bidx) usan HMAC-SHA256 para búsqueda exacta sin descifrar.
// ─────────────────────────────────────────────────────────────────────────────
export const leads = app.table('leads', {
  id:               uuid('id').primaryKey().defaultRandom(),
  publicReference:  uuid('public_reference').notNull().unique().defaultRandom(),
  status:           leadStatusEnum('status').notNull().default('received'),

  // PII cifrada — AES-256-GCM — formato: base64(iv):base64(tag):base64(ciphertext)
  firstNameEnc:     text('first_name_enc').notNull(),
  lastNameEnc:      text('last_name_enc').notNull(),
  emailEnc:         text('email_enc').notNull(),
  phoneEnc:         text('phone_enc').notNull(),
  birthdateEnc:     text('birthdate_enc'),            // opcional: el formulario prepago no pide fecha de nacimiento

  // Blind indexes — HMAC-SHA256 — para búsqueda exacta
  emailBidx:        text('email_bidx').notNull(),
  phoneBidx:        text('phone_bidx').notNull(),

  // No-PII
  stateCode:        text('state_code'),              // clave INEGI de 2 letras (opcional en prepago)
  planCode:         text('plan_code').notNull().default('prepago_100'), // controlado por servidor

  createdAt:        timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt:        timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (t) => [
  index('leads_created_at_idx').on(t.createdAt),
  index('leads_status_idx').on(t.status),
  index('leads_phone_bidx_idx').on(t.phoneBidx),
  index('leads_email_bidx_idx').on(t.emailBidx),
]);

// ─────────────────────────────────────────────────────────────────────────────
// app.lead_secrets — NIP y datos de verificación
// NUNCA en admin, logs, reportes, analytics, CSV, console.log.
// Purge automático tras NIP_RETENTION_HOURS.
// ─────────────────────────────────────────────────────────────────────────────
export const leadSecrets = app.table('lead_secrets', {
  id:                   uuid('id').primaryKey().defaultRandom(),
  leadId:               uuid('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
  nipEnc:               text('nip_enc').notNull(), // AES-256-GCM, NUNCA blind index
  providerChallengeId:  text('provider_challenge_id'), // ID externo OTP si aplica
  verifiedAt:           timestamp('verified_at', { withTimezone: true, mode: 'date' }),
  expiresAt:            timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  createdAt:            timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('lead_secrets_lead_id_uidx').on(t.leadId),
  index('lead_secrets_expires_at_idx').on(t.expiresAt),
]);

// ─────────────────────────────────────────────────────────────────────────────
// app.lead_attribution — First/last touch, UTMs, click IDs
// ─────────────────────────────────────────────────────────────────────────────
export const leadAttribution = app.table('lead_attribution', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  leadId:             uuid('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
  sessionId:          text('session_id'),           // crypto.randomUUID() anónimo

  sourceCategory:     sourceCategoryEnum('source_category').notNull().default('other'),

  // First touch — NUNCA se sobrescribe por acceso directo posterior
  firstUtmSource:     text('first_utm_source'),
  firstUtmMedium:     text('first_utm_medium'),
  firstUtmCampaign:   text('first_utm_campaign'),
  firstUtmTerm:       text('first_utm_term'),
  firstUtmContent:    text('first_utm_content'),

  // Last touch — puede actualizarse
  lastUtmSource:      text('last_utm_source'),
  lastUtmMedium:      text('last_utm_medium'),
  lastUtmCampaign:    text('last_utm_campaign'),
  lastUtmTerm:        text('last_utm_term'),
  lastUtmContent:     text('last_utm_content'),

  // Click IDs — HMAC para atribución/dedupe (nunca se exponen en analytics general)
  gclidHash:          text('gclid_hash'),
  fbclidHash:         text('fbclid_hash'),
  // Click IDs reales cifrados (AES-256-GCM): solo los lee el cron de conversiones
  // para importar conversiones offline a Google Ads / Meta CAPI. Nunca salen al admin.
  gclidEnc:           text('gclid_enc'),
  gbraidEnc:          text('gbraid_enc'),
  wbraidEnc:          text('wbraid_enc'),
  fbclidEnc:          text('fbclid_enc'),
  fbpEnc:             text('fbp_enc'),      // cookie _fbp del Pixel (mejora el match de CAPI)
  userAgent:          text('user_agent'),   // UA del navegador al enviar (CAPI client_user_agent)

  // IDs de Meta Ads (no son PII; la landing los envía como fb_ad_id/fb_adset_id/fb_campaign_id)
  fbAdId:             text('fb_ad_id'),
  fbAdsetId:          text('fb_adset_id'),
  fbCampaignId:       text('fb_campaign_id'),

  landingUrl:         text('landing_url'),
  referrerHost:       text('referrer_host'),

  firstTouchAt:       timestamp('first_touch_at', { withTimezone: true, mode: 'date' }),
  lastTouchAt:        timestamp('last_touch_at', { withTimezone: true, mode: 'date' }),
}, (t) => [
  uniqueIndex('lead_attribution_lead_id_uidx').on(t.leadId),
  index('lead_attribution_source_category_idx').on(t.sourceCategory),
  index('lead_attribution_campaign_idx').on(t.firstUtmCampaign),
]);

// ─────────────────────────────────────────────────────────────────────────────
// app.lead_consents — Consentimientos con versión de política
// ─────────────────────────────────────────────────────────────────────────────
export const leadConsents = app.table('lead_consents', {
  id:                     uuid('id').primaryKey().defaultRandom(),
  leadId:                 uuid('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
  contractingAccepted:    boolean('contracting_accepted').notNull().default(false),
  privacyAccepted:        boolean('privacy_accepted').notNull().default(false),
  privacyPolicyVersion:   text('privacy_policy_version').notNull(),  // desde PRIVACY_POLICY_VERSION env
  termsVersion:           text('terms_version').notNull(),            // desde TERMS_VERSION env
  acceptedAt:             timestamp('accepted_at', { withTimezone: true, mode: 'date' }).notNull(),
}, (t) => [
  uniqueIndex('lead_consents_lead_id_uidx').on(t.leadId),
]);

// ─────────────────────────────────────────────────────────────────────────────
// app.idempotency_keys — Deduplicación técnica de requests
// ─────────────────────────────────────────────────────────────────────────────
export const idempotencyKeys = app.table('idempotency_keys', {
  id:                uuid('id').primaryKey().defaultRandom(),
  idempotencyKey:    text('idempotency_key').notNull(),
  endpoint:          text('endpoint').notNull(),
  requestHash:       text('request_hash').notNull(),         // hash del payload
  responseReference: uuid('response_reference'),              // public_reference del lead
  createdAt:         timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  expiresAt:         timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
}, (t) => [
  uniqueIndex('idempotency_keys_key_endpoint_uidx').on(t.idempotencyKey, t.endpoint),
  index('idempotency_keys_expires_at_idx').on(t.expiresAt),
]);

// ─────────────────────────────────────────────────────────────────────────────
// app.rate_limits — Rate limiting DISTRIBUIDO en Postgres (SEC-004)
// Sin Redis/KV. Bucket fijo por (scope, key_hash, bucket_start).
// key_hash = HMAC de IP o blind index de teléfono — NUNCA IP en claro.
// ─────────────────────────────────────────────────────────────────────────────
export const rateLimits = app.table('rate_limits', {
  scope:       text('scope').notNull(),               // 'leads' | 'otp-send:ip' | 'otp-send:phone' | ...
  keyHash:     text('key_hash').notNull(),            // HMAC(ip) o blindIndex(phone)
  bucketStart: timestamp('bucket_start', { withTimezone: true, mode: 'date' }).notNull(),
  count:       integer('count').notNull().default(0),
  expiresAt:   timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
}, (t) => [
  primaryKey({ columns: [t.scope, t.keyHash, t.bucketStart] }),
  index('rate_limits_expires_at_idx').on(t.expiresAt),
]);

// ─────────────────────────────────────────────────────────────────────────────
// app.analytics_events — First-party analytics server-side
// PROHIBIDO: nombre, teléfono, email, NIP, fecha de nacimiento,
//            IP completa, full user-agent, valores de campos.
// lead_success SOLO lo genera el servidor tras persistir lead válido.
// ─────────────────────────────────────────────────────────────────────────────
export const analyticsEvents = app.table('analytics_events', {
  id:              uuid('id').primaryKey().defaultRandom(),
  eventId:         uuid('event_id').notNull().unique().defaultRandom(), // para dedup CAPI
  sessionId:       text('session_id'),
  eventName:       text('event_name').notNull(),
  pagePath:        text('page_path'),
  sectionId:       text('section_id'),
  ctaId:           text('cta_id'),
  scrollPct:       integer('scroll_pct'),
  errorCode:       text('error_code'),      // ej: 'invalid_phone' — nunca el valor
  sourceCategory:  sourceCategoryEnum('source_category'),
  utmSource:       text('utm_source'),
  utmMedium:       text('utm_medium'),
  utmCampaign:     text('utm_campaign'),
  utmContent:      text('utm_content'),
  utmTerm:         text('utm_term'),
  deviceCategory:  text('device_category'), // 'mobile' | 'tablet' | 'desktop'
  createdAt:       timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (t) => [
  index('analytics_events_created_at_idx').on(t.createdAt),
  index('analytics_events_event_name_idx').on(t.eventName),
  index('analytics_events_session_id_idx').on(t.sessionId),
]);

// ─────────────────────────────────────────────────────────────────────────────
// app.security_events — Registro de eventos de seguridad
// IP: NUNCA completa. Solo HMAC-SHA256 usando IP_HASH_KEY.
// ─────────────────────────────────────────────────────────────────────────────
export const securityEvents = app.table('security_events', {
  id:             uuid('id').primaryKey().defaultRandom(),
  eventType:      securityEventTypeEnum('event_type').notNull(),
  route:          text('route').notNull(),
  ipHash:         text('ip_hash'),           // HMAC-SHA256, no IP completa
  safeMetadata:   text('safe_metadata'),     // JSON stringificado, sin PII
  createdAt:      timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (t) => [
  index('security_events_created_at_idx').on(t.createdAt),
  index('security_events_event_type_idx').on(t.eventType),
]);

// ══════════════════════════════════════════════════════════════════════════════
// ETAPA 2 — ADMIN CONSOLE
// ══════════════════════════════════════════════════════════════════════════════

// ── Enums adicionales ─────────────────────────────────────────────────────────

export const adminRoleEnum = app.enum('admin_role', [
  'Administrador',
  'Editor',
  'Lector',
]);

export const auditActionEnum = app.enum('audit_action', [
  'ADMIN_LOGIN_SUCCESS',
  'ADMIN_LOGIN_DENIED',
  'ADMIN_LOGOUT',
  'ADMIN_ROLE_CHANGED',
  'ADMIN_USER_INVITED',
  'ADMIN_INVITE_RESENT',
  'ADMIN_USER_DISABLED',
  'ADMIN_USER_ENABLED',
  'LEAD_DETAIL_VIEWED',
  'LEAD_STATUS_CHANGED',
  'LEADS_EXPORTED',
  'REPORT_CREATED',
  'REPORT_UPDATED',
  'REPORT_DISABLED',
  'REPORT_MANUAL_RUN',
  'SETTINGS_CHANGED',
  'OUTBOX_RETRY_QUEUED',
]);

export const commercialStatusEnum = app.enum('commercial_status', [
  'NEW',
  'CONTACTED',
  'FOLLOW_UP',
  'WON',
  'LOST',
]);

export const reportFrequencyEnum = app.enum('report_frequency', [
  'DAILY',
  'WEEKLY',
  'MONTHLY',
]);

export const reportRunStatusEnum = app.enum('report_run_status', [
  'PENDING',
  'RUNNING',
  'SENT',
  'SKIPPED_NOT_CONFIGURED',
  'SKIPPED_DUPLICATE',
  'FAILED',
]);

export const adminProfiles = app.table('admin_profiles', {
  id:                   uuid('id').primaryKey().defaultRandom(),
  authUserId:           uuid('auth_user_id').notNull().unique(), // neon_auth.user.id
  role:                 adminRoleEnum('role').notNull(),
  isActive:             boolean('is_active').notNull().default(true),
  createdByAuthUserId:  uuid('created_by_auth_user_id'),        // quién creó este perfil
  createdAt:            timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt:            timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (t) => [
  index('admin_profiles_auth_user_id_idx').on(t.authUserId),
  index('admin_profiles_role_idx').on(t.role),
]);

// ─────────────────────────────────────────────────────────────────────────────
// app.audit_logs — Registro APPEND-ONLY de acciones administrativas
// NUNCA: password, NIP, OTP, API key, secret, token, PII completa, payload.
// ─────────────────────────────────────────────────────────────────────────────
export const auditLogs = app.table('audit_logs', {
  id:             uuid('id').primaryKey().defaultRandom(),
  actorId:        uuid('actor_id'),                   // auth_user_id del actor (null si sistema)
  actorRole:      adminRoleEnum('actor_role'),         // rol al momento de la acción
  action:         auditActionEnum('action').notNull(),
  targetType:     text('target_type'),                // 'lead' | 'admin_user' | 'report' | etc.
  targetId:       uuid('target_id'),                  // ID del recurso afectado
  safeMetadata:   text('safe_metadata'),              // JSON sin PII, solo metadata operacional
  ipHash:         text('ip_hash'),                    // HMAC-SHA256 — nunca IP completa
  createdAt:      timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (t) => [
  index('audit_logs_created_at_idx').on(t.createdAt),
  index('audit_logs_actor_id_idx').on(t.actorId),
  index('audit_logs_action_idx').on(t.action),
  index('audit_logs_target_idx').on(t.targetType, t.targetId),
]);

// ─────────────────────────────────────────────────────────────────────────────
// app.lead_management — Estado comercial CRM separado del estado técnico
// lead.status = estado técnico del pipeline (received → delivered | failed)
// lead_management.commercial_status = estado CRM (NEW/CONTACTED/WON...)
// ─────────────────────────────────────────────────────────────────────────────
export const leadManagement = app.table('lead_management', {
  id:                   uuid('id').primaryKey().defaultRandom(),
  leadId:               uuid('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }).unique(),
  commercialStatus:     commercialStatusEnum('commercial_status').notNull().default('NEW'),
  assignedToAuthUserId: uuid('assigned_to_auth_user_id'),       // neon_auth.user.id
  updatedByAuthUserId:  uuid('updated_by_auth_user_id'),        // neon_auth.user.id
  notes:                text('notes'),                          // Notas internas — NO PII externa
  createdAt:            timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt:            timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (t) => [
  index('lead_management_lead_id_idx').on(t.leadId),
  index('lead_management_status_idx').on(t.commercialStatus),
  index('lead_management_assigned_idx').on(t.assignedToAuthUserId),
]);

// ─────────────────────────────────────────────────────────────────────────────
// app.report_schedules — Programación de reportes periódicos
// ─────────────────────────────────────────────────────────────────────────────
export const reportSchedules = app.table('report_schedules', {
  id:                     uuid('id').primaryKey().defaultRandom(),
  name:                   text('name').notNull(),
  frequency:              reportFrequencyEnum('frequency').notNull().default('DAILY'),
  timezone:               text('timezone').notNull().default('America/Mexico_City'),
  localHour:              smallint('local_hour').notNull().default(8),      // 0-23
  localMinute:            smallint('local_minute').notNull().default(0),     // 0-59
  dayOfWeek:              smallint('day_of_week'),                           // 0=Lunes..6=Domingo (WEEKLY)
  dayOfMonth:             smallint('day_of_month'),                          // 1-28 (MONTHLY)
  recipients:             text('recipients').notNull(),                      // JSON array de emails validados
  includeCsv:             boolean('include_csv').notNull().default(false),
  includeSensitiveFields: boolean('include_sensitive_fields').notNull().default(false),
  isActive:               boolean('is_active').notNull().default(true),
  createdByAuthUserId:    uuid('created_by_auth_user_id'),
  createdAt:              timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt:              timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (t) => [
  index('report_schedules_is_active_idx').on(t.isActive),
  index('report_schedules_frequency_idx').on(t.frequency),
]);

// ─────────────────────────────────────────────────────────────────────────────
// app.report_runs — Registro de ejecuciones de reportes
// run_key UNIQUE garantiza idempotencia: un cron retry no re-envía el reporte.
// NO guardar email completo con datos.
// ─────────────────────────────────────────────────────────────────────────────
export const reportRuns = app.table('report_runs', {
  id:                   uuid('id').primaryKey().defaultRandom(),
  scheduleId:           uuid('schedule_id').references(() => reportSchedules.id, { onDelete: 'set null' }),
  runKey:               text('run_key').notNull().unique(),    // '{scheduleId}:{YYYY-MM-DD}' o similar
  periodStart:          timestamp('period_start', { withTimezone: true, mode: 'date' }).notNull(),
  periodEnd:            timestamp('period_end', { withTimezone: true, mode: 'date' }).notNull(),
  status:               reportRunStatusEnum('status').notNull().default('PENDING'),
  leadCount:            integer('lead_count').notNull().default(0),
  providerMessageId:    text('provider_message_id'),           // ID de Brevo si envió
  attemptCount:         integer('attempt_count').notNull().default(0),
  errorCode:            text('error_code'),                    // código saneado, sin datos
  startedAt:            timestamp('started_at', { withTimezone: true, mode: 'date' }),
  finishedAt:           timestamp('finished_at', { withTimezone: true, mode: 'date' }),
  createdAt:            timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (t) => [
  index('report_runs_schedule_id_idx').on(t.scheduleId),
  index('report_runs_status_idx').on(t.status),
  index('report_runs_period_idx').on(t.periodStart, t.periodEnd),
]);

// ─────────────────────────────────────────────────────────────────────────────
// app.delivery_outbox — Entrega de portabilidades a Intelix con reintentos
// El lead NO se pierde si Intelix cae. La DB es source of truth. El NIP que
// necesita Intelix vive cifrado en lead_secrets solo hasta que se entrega.
// ─────────────────────────────────────────────────────────────────────────────
export const deliveryOutbox = app.table('delivery_outbox', {
  id:             uuid('id').primaryKey().defaultRandom(),
  leadId:         uuid('lead_id').notNull().references(() => leads.id),
  destination:    text('destination').notNull(),   // 'intelix'
  status:         outboxStatusEnum('status').notNull().default('pending'),
  attempts:       integer('attempts').notNull().default(0),
  nextAttemptAt:  timestamp('next_attempt_at', { withTimezone: true, mode: 'date' }),
  deliveredAt:    timestamp('delivered_at', { withTimezone: true, mode: 'date' }),
  lastErrorCode:  text('last_error_code'),         // código corto, nunca la respuesta completa
  lastErrorPayload: jsonb('last_error_payload'),   // payload enviado ENMASCARADO + respuesta de Intelix (debug en Logs)
  // ── Lease / claim exclusivo (FLW-004) ──────────────────────────────────────
  lockedAt:       timestamp('locked_at', { withTimezone: true, mode: 'date' }),
  leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true, mode: 'date' }),
  lockedBy:       text('locked_by'),               // id efímero del worker
  createdAt:      timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt:      timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (t) => [
  index('delivery_outbox_status_next_attempt_idx').on(t.status, t.nextAttemptAt),
  index('delivery_outbox_lead_id_idx').on(t.leadId),
  index('delivery_outbox_lease_idx').on(t.status, t.leaseExpiresAt),
]);

// ─────────────────────────────────────────────────────────────────────────────
// app.conversion_deliveries — Cola de conversiones hacia plataformas de anuncios
// Una fila por (lead, proveedor, evento). El alta del lead solo encola; el cron
// /api/cron/conversions envía con reintentos y backoff. Nunca guarda PII ni
// respuestas completas del proveedor (solo un código/mensaje corto de error).
// ─────────────────────────────────────────────────────────────────────────────
export const conversionProviderEnum = app.enum('conversion_provider', ['google_ads', 'meta_capi']);
export const conversionEventEnum = app.enum('conversion_event', ['lead', 'won']);
export const conversionDeliveryStatusEnum = app.enum('conversion_delivery_status', [
  'pending', 'sent', 'failed', 'dead', 'skipped',
]);

export const conversionDeliveries = app.table('conversion_deliveries', {
  id:             uuid('id').primaryKey().defaultRandom(),
  leadId:         uuid('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
  provider:       conversionProviderEnum('provider').notNull(),
  event:          conversionEventEnum('event').notNull(),
  eventId:        text('event_id').notNull(),          // = event_id del Pixel (dedupe CAPI) / order_id en Google Ads
  occurredAt:     timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull(),
  status:         conversionDeliveryStatusEnum('status').notNull().default('pending'),
  attempts:       integer('attempts').notNull().default(0),
  nextAttemptAt:  timestamp('next_attempt_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  sentAt:         timestamp('sent_at', { withTimezone: true, mode: 'date' }),
  lastError:      text('last_error'),                  // código/mensaje corto, nunca el payload
  createdAt:      timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt:      timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('conversion_deliveries_lead_provider_event_uidx').on(t.leadId, t.provider, t.event),
  index('conversion_deliveries_status_next_idx').on(t.status, t.nextAttemptAt),
]);

// ─────────────────────────────────────────────────────────────────────────────
// app.captcha_challenges — CAPTCHA propio de la landing (single-use, HMAC)
// Solo se guarda HMAC-SHA256(CAPTCHA_PEPPER, id:respuesta); nunca la respuesta.
// client_hash = HMAC de la IP (nunca IP en claro). Purga por expires_at (cron).
// ─────────────────────────────────────────────────────────────────────────────
export const captchaChallenges = app.table('captcha_challenges', {
  id:          uuid('id').primaryKey().defaultRandom(),
  answerHash:  text('answer_hash').notNull(),
  clientHash:  text('client_hash'),
  expiresAt:   timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  usedAt:      timestamp('used_at', { withTimezone: true, mode: 'date' }),
  createdAt:   timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (t) => [
  index('captcha_challenges_expires_at_idx').on(t.expiresAt),
  index('captcha_challenges_client_hash_created_at_idx').on(t.clientHash, t.createdAt),
]);

// ─────────────────────────────────────────────────────────────────────────────
// app.settings — Configuración general editable desde admin panel (ej: gtmId)
// ─────────────────────────────────────────────────────────────────────────────
export const settings = app.table('settings', {
  key:        text('key').primaryKey(),
  value:      text('value'), // string plano o JSON (en texto) dependiendo del key
  updatedAt:  timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

// ─────────────────────────────────────────────────────────────────────────────
// app.ads_metrics — Métricas de rendimiento agregadas diarias (SEM)
// ─────────────────────────────────────────────────────────────────────────────
export const adsMetrics = app.table('ads_metrics', {
  id:           uuid('id').primaryKey().defaultRandom(),
  date:         date('date').notNull(), // YYYY-MM-DD
  campaignId:   varchar('campaign_id', { length: 50 }).notNull(),
  campaignName: text('campaign_name').notNull(),
  impressions:  integer('impressions').notNull().default(0),
  clicks:       integer('clicks').notNull().default(0),
  costMicros:   bigint('cost_micros', { mode: 'number' }).notNull().default(0),
  conversions:  numeric('conversions').notNull().default('0'),
  createdAt:    timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt:    timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (t) => [
  index('ads_metrics_date_idx').on(t.date),
  uniqueIndex('ads_metrics_date_campaign_uidx').on(t.date, t.campaignId),
]);
