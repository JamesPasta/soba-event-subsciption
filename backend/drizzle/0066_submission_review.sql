CREATE TABLE "soba"."submission_status" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"status" text NOT NULL,
	"assignee_id" uuid,
	"changed_by" uuid,
	"changed_by_label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submission_status_status_check" CHECK ("status" IN ('SUBMITTED', 'ASSIGNED', 'REVISING', 'COMPLETED'))
);
--> statement-breakpoint
ALTER TABLE "soba"."submission_status" ADD CONSTRAINT "submission_status_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "soba"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soba"."submission_status" ADD CONSTRAINT "submission_status_submission_id_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "soba"."submission"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soba"."submission_status" ADD CONSTRAINT "submission_status_assignee_id_app_user_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "soba"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soba"."submission_status" ADD CONSTRAINT "submission_status_changed_by_app_user_id_fk" FOREIGN KEY ("changed_by") REFERENCES "soba"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "submission_status_submission_idx" ON "soba"."submission_status" ("submission_id","created_at" DESC);--> statement-breakpoint
CREATE INDEX "submission_status_workspace_idx" ON "soba"."submission_status" ("workspace_id");--> statement-breakpoint
CREATE INDEX "submission_status_assignee_idx" ON "soba"."submission_status" ("assignee_id");--> statement-breakpoint
ALTER TABLE "soba"."submission" ADD COLUMN "status_id" uuid;--> statement-breakpoint
ALTER TABLE "soba"."submission" ADD CONSTRAINT "submission_status_id_submission_status_id_fk" FOREIGN KEY ("status_id") REFERENCES "soba"."submission_status"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "submission_status_id_idx" ON "soba"."submission" ("status_id");--> statement-breakpoint
CREATE TABLE "soba"."submission_note" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"text" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_by_label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submission_note_text_check" CHECK (char_length("text") BETWEEN 1 AND 4000)
);
--> statement-breakpoint
ALTER TABLE "soba"."submission_note" ADD CONSTRAINT "submission_note_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "soba"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soba"."submission_note" ADD CONSTRAINT "submission_note_submission_id_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "soba"."submission"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soba"."submission_note" ADD CONSTRAINT "submission_note_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "soba"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "submission_note_submission_idx" ON "soba"."submission_note" ("submission_id","created_at" DESC);--> statement-breakpoint
CREATE INDEX "submission_note_workspace_idx" ON "soba"."submission_note" ("workspace_id");--> statement-breakpoint
-- Every submission already submitted starts its review as Submitted, at the time it was submitted
-- and under its submitter. Deleted submissions are included, so a restore finds a status.
INSERT INTO "soba"."submission_status" ("id", "workspace_id", "submission_id", "status", "changed_by", "changed_by_label", "created_at")
SELECT gen_random_uuid(), s."workspace_id", s."id", 'SUBMITTED', s."submitted_by", s."created_by", s."submitted_at"
FROM "soba"."submission" s
WHERE s."submitted_at" IS NOT NULL AND s."status_id" IS NULL;--> statement-breakpoint
UPDATE "soba"."submission" s
SET "status_id" = st."id"
FROM "soba"."submission_status" st
WHERE st."submission_id" = s."id" AND s."status_id" IS NULL;
