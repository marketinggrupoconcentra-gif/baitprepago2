CREATE TYPE "app"."admin_role" AS ENUM('Administrador', 'Editor', 'Lector');--> statement-breakpoint
CREATE TYPE "app"."audit_action" AS ENUM('ADMIN_LOGIN_SUCCESS', 'ADMIN_LOGIN_DENIED', 'ADMIN_LOGOUT', 'ADMIN_ROLE_CHANGED', 'ADMIN_USER_INVITED', 'ADMIN_INVITE_RESENT', 'ADMIN_USER_DISABLED', 'ADMIN_USER_ENABLED', 'LEAD_DETAIL_VIEWED', 'LEAD_STATUS_CHANGED', 'LEADS_EXPORTED', 'REPORT_CREATED', 'REPORT_UPDATED', 'REPORT_DISABLED', 'REPORT_MANUAL_RUN', 'SETTINGS_CHANGED');--> statement-breakpoint
CREATE TYPE "app"."commercial_status" AS ENUM('NEW', 'CONTACTED', 'FOLLOW_UP', 'WON', 'LOST');--> statement-breakpoint
CREATE TYPE "app"."integration_delivery_status" AS ENUM('PENDING', 'DELIVERED', 'FAILED', 'DEAD');--> statement-breakpoint
CREATE TYPE "app"."report_frequency" AS ENUM('DAILY', 'WEEKLY', 'MONTHLY');--> statement-breakpoint
CREATE TYPE "app"."report_run_status" AS ENUM('PENDING', 'RUNNING', 'SENT', 'SKIPPED_NOT_CONFIGURED', 'SKIPPED_DUPLICATE', 'FAILED');--> statement-breakpoint
CREATE TABLE "app"."admin_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_user_id" uuid NOT NULL,
	"role" "app"."admin_role" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_auth_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_profiles_auth_user_id_unique" UNIQUE("auth_user_id")
);
--> statement-breakpoint
CREATE TABLE "app"."audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"actor_role" "app"."admin_role",
	"action" "app"."audit_action" NOT NULL,
	"target_type" text,
	"target_id" uuid,
	"safe_metadata" text,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."integration_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"integration" text NOT NULL,
	"event_name" text NOT NULL,
	"event_id" uuid NOT NULL,
	"lead_id" uuid,
	"status" "app"."integration_delivery_status" DEFAULT 'PENDING' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_http_status" smallint,
	"next_attempt_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_deliveries_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE "app"."lead_management" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"commercial_status" "app"."commercial_status" DEFAULT 'NEW' NOT NULL,
	"assigned_to_auth_user_id" uuid,
	"updated_by_auth_user_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_management_lead_id_unique" UNIQUE("lead_id")
);
--> statement-breakpoint
CREATE TABLE "app"."report_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid,
	"run_key" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"status" "app"."report_run_status" DEFAULT 'PENDING' NOT NULL,
	"lead_count" integer DEFAULT 0 NOT NULL,
	"provider_message_id" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_runs_run_key_unique" UNIQUE("run_key")
);
--> statement-breakpoint
CREATE TABLE "app"."report_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"frequency" "app"."report_frequency" DEFAULT 'DAILY' NOT NULL,
	"timezone" text DEFAULT 'America/Mexico_City' NOT NULL,
	"local_hour" smallint DEFAULT 8 NOT NULL,
	"local_minute" smallint DEFAULT 0 NOT NULL,
	"day_of_week" smallint,
	"day_of_month" smallint,
	"recipients" text NOT NULL,
	"include_csv" boolean DEFAULT false NOT NULL,
	"include_sensitive_fields" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_auth_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."lead_management" ADD CONSTRAINT "lead_management_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "app"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."report_runs" ADD CONSTRAINT "report_runs_schedule_id_report_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "app"."report_schedules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_profiles_auth_user_id_idx" ON "app"."admin_profiles" USING btree ("auth_user_id");--> statement-breakpoint
CREATE INDEX "admin_profiles_role_idx" ON "app"."admin_profiles" USING btree ("role");--> statement-breakpoint
CREATE INDEX "audit_logs_created_at_idx" ON "app"."audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_id_idx" ON "app"."audit_logs" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "app"."audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_logs_target_idx" ON "app"."audit_logs" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "integration_deliveries_status_idx" ON "app"."integration_deliveries" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "integration_deliveries_integration_idx" ON "app"."integration_deliveries" USING btree ("integration");--> statement-breakpoint
CREATE INDEX "integration_deliveries_lead_id_idx" ON "app"."integration_deliveries" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "lead_management_lead_id_idx" ON "app"."lead_management" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "lead_management_status_idx" ON "app"."lead_management" USING btree ("commercial_status");--> statement-breakpoint
CREATE INDEX "lead_management_assigned_idx" ON "app"."lead_management" USING btree ("assigned_to_auth_user_id");--> statement-breakpoint
CREATE INDEX "report_runs_schedule_id_idx" ON "app"."report_runs" USING btree ("schedule_id");--> statement-breakpoint
CREATE INDEX "report_runs_status_idx" ON "app"."report_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "report_runs_period_idx" ON "app"."report_runs" USING btree ("period_start","period_end");--> statement-breakpoint
CREATE INDEX "report_schedules_is_active_idx" ON "app"."report_schedules" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "report_schedules_frequency_idx" ON "app"."report_schedules" USING btree ("frequency");