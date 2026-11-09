ALTER TABLE "soba"."submission_revision" ADD COLUMN "status" text;--> statement-breakpoint
ALTER TABLE "soba"."submission_revision" ADD COLUMN "reason" text;--> statement-breakpoint

UPDATE "soba"."submission_revision" r
SET "status" = 'current', "reason" = 'accepted'
FROM "soba"."submission" s
WHERE s."head_revision_id" = r."id";--> statement-breakpoint

UPDATE "soba"."submission_revision"
SET "status" = 'superseded', "reason" = 'replaced'
WHERE "status" IS NULL;--> statement-breakpoint

ALTER TABLE "soba"."submission_revision" ALTER COLUMN "status" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "soba"."submission_revision" ALTER COLUMN "reason" SET NOT NULL;
