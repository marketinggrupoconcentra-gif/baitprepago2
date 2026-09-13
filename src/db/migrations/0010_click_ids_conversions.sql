CREATE TYPE "app"."conversion_delivery_status" AS ENUM('pending', 'sent', 'failed', 'dead', 'skipped');--> statement-breakpoint
CREATE TYPE "app"."conversion_event" AS ENUM('lead', 'won');--> statement-breakpoint
CREATE TYPE "app"."conversion_provider" AS ENUM('google_ads', 'meta_capi');--> statement-breakpoint
CREATE TABLE "app"."conversion_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"provider" "app"."conversion_provider" NOT NULL,
	"event" "app"."conversion_event" NOT NULL,
	"event_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"status" "app"."conversion_delivery_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."lead_attribution" ADD COLUMN "gclid_enc" text;--> statement-breakpoint
ALTER TABLE "app"."lead_attribution" ADD COLUMN "gbraid_enc" text;--> statement-breakpoint
ALTER TABLE "app"."lead_attribution" ADD COLUMN "wbraid_enc" text;--> statement-breakpoint
ALTER TABLE "app"."lead_attribution" ADD COLUMN "fbclid_enc" text;--> statement-breakpoint
ALTER TABLE "app"."lead_attribution" ADD COLUMN "fbp_enc" text;--> statement-breakpoint
ALTER TABLE "app"."lead_attribution" ADD COLUMN "user_agent" text;--> statement-breakpoint
ALTER TABLE "app"."conversion_deliveries" ADD CONSTRAINT "conversion_deliveries_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "app"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversion_deliveries_lead_provider_event_uidx" ON "app"."conversion_deliveries" USING btree ("lead_id","provider","event");--> statement-breakpoint
CREATE INDEX "conversion_deliveries_status_next_idx" ON "app"."conversion_deliveries" USING btree ("status","next_attempt_at");