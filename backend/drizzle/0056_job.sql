CREATE TABLE "soba"."job" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"workspace_id" uuid NOT NULL,
	"form_id" uuid,
	"submission_id" uuid,
	"revision_id" uuid,
	"parent_job_id" uuid,
	"action_config_id" uuid,
	"created_by" uuid NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"params_version" integer DEFAULT 1 NOT NULL,
	"dedupe_key" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"claim_token" uuid,
	"lease_until" timestamp with time zone,
	"cancel_requested_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "soba"."job" ADD CONSTRAINT "job_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "soba"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soba"."job" ADD CONSTRAINT "job_form_id_form_id_fk" FOREIGN KEY ("form_id") REFERENCES "soba"."form"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soba"."job" ADD CONSTRAINT "job_submission_id_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "soba"."submission"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soba"."job" ADD CONSTRAINT "job_revision_id_submission_revision_id_fk" FOREIGN KEY ("revision_id") REFERENCES "soba"."submission_revision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soba"."job" ADD CONSTRAINT "job_parent_job_id_job_id_fk" FOREIGN KEY ("parent_job_id") REFERENCES "soba"."job"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soba"."job" ADD CONSTRAINT "job_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "soba"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_dedupe_key_uq" ON "soba"."job" ("dedupe_key");--> statement-breakpoint
CREATE INDEX "job_claim_idx" ON "soba"."job" ("type","run_after") WHERE "status" = 'queued';--> statement-breakpoint
CREATE INDEX "job_lease_idx" ON "soba"."job" ("lease_until") WHERE "status" = 'running';--> statement-breakpoint
CREATE INDEX "job_parent_idx" ON "soba"."job" ("parent_job_id") WHERE "parent_job_id" is not null;--> statement-breakpoint
CREATE INDEX "job_finished_idx" ON "soba"."job" ("finished_at") WHERE "finished_at" is not null;--> statement-breakpoint
CREATE INDEX "job_workspace_idx" ON "soba"."job" ("workspace_id");--> statement-breakpoint
CREATE INDEX "job_form_idx" ON "soba"."job" ("form_id");--> statement-breakpoint
CREATE INDEX "job_submission_idx" ON "soba"."job" ("submission_id");--> statement-breakpoint
CREATE INDEX "job_revision_idx" ON "soba"."job" ("revision_id");--> statement-breakpoint
INSERT INTO "soba"."feature" ("code","name","description","version","status","availability","created_by","updated_by") VALUES
	('post-submission','Post-submission','Queuing work after a submission is received',NULL,'disabled','fixed','SOBA System (seed)','SOBA System (seed)')
ON CONFLICT DO NOTHING;
