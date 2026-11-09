CREATE TABLE "soba"."post_submission_action_setting" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"form_id" uuid,
	"action_code" text NOT NULL,
	"inherit" boolean DEFAULT true NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	CONSTRAINT "post_submission_action_setting_scope_uq" UNIQUE NULLS NOT DISTINCT("workspace_id","form_id","action_code")
);
--> statement-breakpoint
ALTER TABLE "soba"."post_submission_action_setting" ADD CONSTRAINT "post_submission_action_setting_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "soba"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soba"."post_submission_action_setting" ADD CONSTRAINT "post_submission_action_setting_form_id_form_id_fk" FOREIGN KEY ("form_id") REFERENCES "soba"."form"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "post_submission_action_setting_form_idx" ON "soba"."post_submission_action_setting" ("form_id");
