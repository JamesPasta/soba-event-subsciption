ALTER TABLE "soba"."job" ADD COLUMN "requeue_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "soba"."job" ADD COLUMN "last_requeued_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "soba"."job" ADD COLUMN "last_requeued_by" uuid;--> statement-breakpoint
ALTER TABLE "soba"."job" ADD COLUMN "children_queued_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "soba"."job" ADD CONSTRAINT "job_last_requeued_by_app_user_id_fk" FOREIGN KEY ("last_requeued_by") REFERENCES "soba"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_created_idx" ON "soba"."job" ("created_at" DESC,"id" DESC);--> statement-breakpoint
-- Jobs that queued children before the column existed, while their children are still kept.
UPDATE "soba"."job" AS "parent"
SET "children_queued_at" = "first"."created_at"
FROM (
  SELECT "parent_job_id", min("created_at") AS "created_at"
  FROM "soba"."job"
  WHERE "parent_job_id" IS NOT NULL
  GROUP BY "parent_job_id"
) AS "first"
WHERE "first"."parent_job_id" = "parent"."id";
