CREATE TABLE "app"."captcha_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"answer_hash" text NOT NULL,
	"client_hash" text,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."ads_metrics" ALTER COLUMN "date" SET DATA TYPE date;--> statement-breakpoint
ALTER TABLE "app"."ads_metrics" ALTER COLUMN "campaign_id" SET DATA TYPE varchar(50);--> statement-breakpoint
ALTER TABLE "app"."ads_metrics" ALTER COLUMN "cost_micros" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "app"."ads_metrics" ALTER COLUMN "conversions" SET DATA TYPE numeric;--> statement-breakpoint
ALTER TABLE "app"."ads_metrics" ALTER COLUMN "conversions" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "app"."leads" ALTER COLUMN "birthdate_enc" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."leads" ALTER COLUMN "state_code" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."leads" ALTER COLUMN "plan_code" SET DEFAULT 'prepago_100';--> statement-breakpoint
ALTER TABLE "app"."lead_attribution" ADD COLUMN "fb_ad_id" text;--> statement-breakpoint
ALTER TABLE "app"."lead_attribution" ADD COLUMN "fb_adset_id" text;--> statement-breakpoint
ALTER TABLE "app"."lead_attribution" ADD COLUMN "fb_campaign_id" text;--> statement-breakpoint
CREATE INDEX "captcha_challenges_expires_at_idx" ON "app"."captcha_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "captcha_challenges_client_hash_created_at_idx" ON "app"."captcha_challenges" USING btree ("client_hash","created_at");