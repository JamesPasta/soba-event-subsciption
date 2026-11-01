ALTER TABLE "soba"."job" ADD COLUMN "progress_done" integer;--> statement-breakpoint
ALTER TABLE "soba"."job" ADD COLUMN "progress_total" integer;--> statement-breakpoint
ALTER TABLE "soba"."job" ADD COLUMN "result_file_id" uuid;--> statement-breakpoint
ALTER TABLE "soba"."job" ADD COLUMN "result_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "soba"."job" ADD CONSTRAINT "job_result_file_id_file_id_fk" FOREIGN KEY ("result_file_id") REFERENCES "soba"."file"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_result_file_idx" ON "soba"."job" ("result_file_id") WHERE "result_file_id" is not null;--> statement-breakpoint
CREATE INDEX "job_active_export_idx" ON "soba"."job" ("form_id") WHERE "type" = 'submission-export' and "status" in ('queued', 'running');--> statement-breakpoint
CREATE TABLE "soba"."submission_export_audit" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"form_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"file_id" uuid,
	"action" text NOT NULL,
	"format" text NOT NULL,
	"row_count" integer,
	"unread_count" integer,
	"size" integer,
	"request_id" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "soba"."submission_export_audit" ADD CONSTRAINT "submission_export_audit_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "soba"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soba"."submission_export_audit" ADD CONSTRAINT "submission_export_audit_form_id_form_id_fk" FOREIGN KEY ("form_id") REFERENCES "soba"."form"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soba"."submission_export_audit" ADD CONSTRAINT "submission_export_audit_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "soba"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "submission_export_audit_form_created_idx" ON "soba"."submission_export_audit" ("form_id","created_at");--> statement-breakpoint
CREATE INDEX "submission_export_audit_workspace_idx" ON "soba"."submission_export_audit" ("workspace_id");--> statement-breakpoint
CREATE INDEX "submission_export_audit_job_idx" ON "soba"."submission_export_audit" ("job_id");--> statement-breakpoint
INSERT INTO "soba"."feature" ("code","name","description","version","status","availability","created_by","updated_by") VALUES
	('submission-export','Submission export','Exporting a form''s submissions to a file, run as a background job',NULL,'disabled','fixed','SOBA System (seed)','SOBA System (seed)')
ON CONFLICT DO NOTHING;
