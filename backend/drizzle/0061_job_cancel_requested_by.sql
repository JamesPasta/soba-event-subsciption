ALTER TABLE "soba"."job" ADD COLUMN "cancel_requested_by" uuid;--> statement-breakpoint
ALTER TABLE "soba"."job" ADD COLUMN "cancel_requested_by_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "soba"."job" ADD COLUMN "last_requeued_by_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "soba"."job" ADD CONSTRAINT "job_cancel_requested_by_app_user_id_fk" FOREIGN KEY ("cancel_requested_by") REFERENCES "soba"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Until now only the administration routes ran a job again.
UPDATE "soba"."job" SET "last_requeued_by_admin" = true WHERE "last_requeued_by" IS NOT NULL;--> statement-breakpoint
-- Hourly-limit reasons written before carry how much email was sent; staff now read them. The
-- environment's carry no numbers at all, as they describe every workspace's email.
UPDATE "soba"."job"
SET "last_error" = 'Hourly email limit for this environment reached; try again later'
WHERE "last_error" LIKE 'Hourly email limit for the environment reached:%';--> statement-breakpoint
UPDATE "soba"."job"
SET "last_error" = regexp_replace("last_error", ': [0-9]+ sent( or refused)? in the last hour, ', ': ')
WHERE "last_error" LIKE 'Hourly email limit for the %';
