CREATE TABLE "app"."otp_proofs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_bidx" text NOT NULL,
	"proof_hash" text NOT NULL,
	"purpose" text DEFAULT 'lead_submission' NOT NULL,
	"session_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "otp_proofs_proof_hash_unique" UNIQUE("proof_hash")
);
--> statement-breakpoint
CREATE TABLE "app"."rate_limits" (
	"scope" text NOT NULL,
	"key_hash" text NOT NULL,
	"bucket_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "rate_limits_scope_key_hash_bucket_start_pk" PRIMARY KEY("scope","key_hash","bucket_start")
);
--> statement-breakpoint
ALTER TABLE "app"."delivery_outbox" ADD COLUMN "locked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."delivery_outbox" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."delivery_outbox" ADD COLUMN "locked_by" text;--> statement-breakpoint
CREATE INDEX "otp_proofs_phone_purpose_idx" ON "app"."otp_proofs" USING btree ("phone_bidx","purpose");--> statement-breakpoint
CREATE INDEX "otp_proofs_expires_at_idx" ON "app"."otp_proofs" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "rate_limits_expires_at_idx" ON "app"."rate_limits" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "delivery_outbox_lease_idx" ON "app"."delivery_outbox" USING btree ("status","lease_expires_at");