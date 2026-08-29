CREATE TYPE "public"."plan_recurrence" AS ENUM('none', 'daily', 'weekly', 'monthly', 'yearly');--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "recurrence" "plan_recurrence" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "recurrence_days" smallint[] DEFAULT '{}'::smallint[] NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "last_notified_on" date;