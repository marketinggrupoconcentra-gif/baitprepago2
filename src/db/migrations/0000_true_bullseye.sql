CREATE SCHEMA "app";
--> statement-breakpoint
CREATE TYPE "app"."lead_status" AS ENUM('received', 'processing', 'delivered', 'failed', 'duplicate');--> statement-breakpoint
CREATE TYPE "app"."outbox_status" AS ENUM('pending', 'processing', 'delivered', 'failed', 'dead');--> statement-breakpoint
CREATE TYPE "app"."security_event_type" AS ENUM('bot_block', 'honeypot', 'rate_limit', 'invalid_origin', 'oversized_body', 'schema_rejection', 'replay', 'duplicate', 'otp_failure', 'auth_failure', 'suspicious_request');--> statement-breakpoint
CREATE TYPE "app"."source_category" AS ENUM('google_ads', 'meta_ads', 'paid_other', 'organic', 'referral', 'direct', 'other');--> statement-breakpoint
CREATE TABLE "app"."analytics_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"session_id" text,
	"event_name" text NOT NULL,
	"page_path" text,
	"section_id" text,
	"cta_id" text,
	"scroll_pct" integer,
	"error_code" text,
	"source_category" "app"."source_category",
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"utm_content" text,
	"utm_term" text,
	"device_category" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_events_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE "app"."delivery_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"destination" text NOT NULL,
	"status" "app"."outbox_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idempotency_key" text NOT NULL,
	"endpoint" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_reference" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."lead_attribution" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"session_id" text,
	"source_category" "app"."source_category" DEFAULT 'other' NOT NULL,
	"first_utm_source" text,
	"first_utm_medium" text,
	"first_utm_campaign" text,
	"first_utm_term" text,
	"first_utm_content" text,
	"last_utm_source" text,
	"last_utm_medium" text,
	"last_utm_campaign" text,
	"last_utm_term" text,
	"last_utm_content" text,
	"gclid_hash" text,
	"fbclid_hash" text,
	"landing_url" text,
	"referrer_host" text,
	"first_touch_at" timestamp with time zone,
	"last_touch_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app"."lead_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"contracting_accepted" boolean DEFAULT false NOT NULL,
	"privacy_accepted" boolean DEFAULT false NOT NULL,
	"privacy_policy_version" text NOT NULL,
	"terms_version" text NOT NULL,
	"accepted_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."lead_secrets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"nip_enc" text NOT NULL,
	"provider_challenge_id" text,
	"verified_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_reference" uuid DEFAULT gen_random_uuid() NOT NULL,
	"status" "app"."lead_status" DEFAULT 'received' NOT NULL,
	"first_name_enc" text NOT NULL,
	"last_name_enc" text NOT NULL,
	"email_enc" text NOT NULL,
	"phone_enc" text NOT NULL,
	"birthdate_enc" text NOT NULL,
	"email_bidx" text NOT NULL,
	"phone_bidx" text NOT NULL,
	"state_code" text NOT NULL,
	"plan_code" text DEFAULT 'pospago_199' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leads_public_reference_unique" UNIQUE("public_reference")
);
--> statement-breakpoint
CREATE TABLE "app"."security_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" "app"."security_event_type" NOT NULL,
	"route" text NOT NULL,
	"ip_hash" text,
	"safe_metadata" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."delivery_outbox" ADD CONSTRAINT "delivery_outbox_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "app"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."lead_attribution" ADD CONSTRAINT "lead_attribution_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "app"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."lead_consents" ADD CONSTRAINT "lead_consents_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "app"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."lead_secrets" ADD CONSTRAINT "lead_secrets_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "app"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analytics_events_created_at_idx" ON "app"."analytics_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "analytics_events_event_name_idx" ON "app"."analytics_events" USING btree ("event_name");--> statement-breakpoint
CREATE INDEX "analytics_events_session_id_idx" ON "app"."analytics_events" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "delivery_outbox_status_next_attempt_idx" ON "app"."delivery_outbox" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "delivery_outbox_lead_id_idx" ON "app"."delivery_outbox" USING btree ("lead_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_keys_key_endpoint_uidx" ON "app"."idempotency_keys" USING btree ("idempotency_key","endpoint");--> statement-breakpoint
CREATE INDEX "idempotency_keys_expires_at_idx" ON "app"."idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_attribution_lead_id_uidx" ON "app"."lead_attribution" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "lead_attribution_source_category_idx" ON "app"."lead_attribution" USING btree ("source_category");--> statement-breakpoint
CREATE INDEX "lead_attribution_campaign_idx" ON "app"."lead_attribution" USING btree ("first_utm_campaign");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_consents_lead_id_uidx" ON "app"."lead_consents" USING btree ("lead_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_secrets_lead_id_uidx" ON "app"."lead_secrets" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "lead_secrets_expires_at_idx" ON "app"."lead_secrets" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "leads_created_at_idx" ON "app"."leads" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "leads_status_idx" ON "app"."leads" USING btree ("status");--> statement-breakpoint
CREATE INDEX "leads_phone_bidx_idx" ON "app"."leads" USING btree ("phone_bidx");--> statement-breakpoint
CREATE INDEX "leads_email_bidx_idx" ON "app"."leads" USING btree ("email_bidx");--> statement-breakpoint
CREATE INDEX "security_events_created_at_idx" ON "app"."security_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "security_events_event_type_idx" ON "app"."security_events" USING btree ("event_type");