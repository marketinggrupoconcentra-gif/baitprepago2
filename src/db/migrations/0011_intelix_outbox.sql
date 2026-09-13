CREATE TYPE "app"."outbox_status" AS ENUM('pending', 'processing', 'delivered', 'failed', 'dead');--> statement-breakpoint
CREATE TABLE "app"."delivery_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"destination" text NOT NULL,
	"status" "app"."outbox_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"last_error_code" text,
	"last_error_payload" jsonb,
	"locked_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone,
	"locked_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."delivery_outbox" ADD CONSTRAINT "delivery_outbox_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "app"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "delivery_outbox_status_next_attempt_idx" ON "app"."delivery_outbox" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "delivery_outbox_lead_id_idx" ON "app"."delivery_outbox" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "delivery_outbox_lease_idx" ON "app"."delivery_outbox" USING btree ("status","lease_expires_at");