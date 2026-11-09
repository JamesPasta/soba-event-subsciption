ALTER TABLE "soba"."workspace_audience_setting" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "soba"."form_audience_setting" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "soba"."workspace_submitter_setting" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "soba"."form_submitter_setting" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;
