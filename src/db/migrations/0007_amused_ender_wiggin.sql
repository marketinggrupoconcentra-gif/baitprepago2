CREATE TABLE "app"."ads_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"campaign_id" text NOT NULL,
	"campaign_name" text NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"cost_micros" integer DEFAULT 0 NOT NULL,
	"conversions" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ads_metrics_date_idx" ON "app"."ads_metrics" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "ads_metrics_date_campaign_uidx" ON "app"."ads_metrics" USING btree ("date","campaign_id");