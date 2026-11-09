CREATE TABLE "soba"."submission_file" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text
);
--> statement-breakpoint
ALTER TABLE "soba"."submission_file" ADD CONSTRAINT "submission_file_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "soba"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soba"."submission_file" ADD CONSTRAINT "submission_file_submission_id_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "soba"."submission"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soba"."submission_file" ADD CONSTRAINT "submission_file_file_id_file_id_fk" FOREIGN KEY ("file_id") REFERENCES "soba"."file"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "submission_file_file_uq" ON "soba"."submission_file" ("file_id");--> statement-breakpoint
CREATE INDEX "submission_file_submission_idx" ON "soba"."submission_file" ("submission_id");--> statement-breakpoint
CREATE INDEX "submission_file_workspace_idx" ON "soba"."submission_file" ("workspace_id");--> statement-breakpoint

-- A file is linked to the submission its submission_id names. A null id, or one naming no
-- submission in the file's workspace, gets no link.
INSERT INTO "soba"."submission_file"
	("id", "workspace_id", "submission_id", "file_id", "created_at", "created_by", "updated_by")
SELECT gen_random_uuid(), f."workspace_id", f."submission_id", f."id", f."created_at", f."created_by",
	'SOBA System (migration)'
FROM "soba"."file" f
JOIN "soba"."submission" s ON s."id" = f."submission_id" AND s."workspace_id" = f."workspace_id";--> statement-breakpoint
DROP INDEX "soba"."file_submission_idx";--> statement-breakpoint
ALTER TABLE "soba"."file" DROP COLUMN "submission_id";
