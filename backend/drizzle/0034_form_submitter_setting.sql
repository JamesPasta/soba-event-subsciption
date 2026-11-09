CREATE TABLE "soba"."form_submitter_setting" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"form_id" uuid NOT NULL,
	"allow_submitter_drafts" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text
);
--> statement-breakpoint
ALTER TABLE "soba"."form_submitter_setting" ADD CONSTRAINT "form_submitter_setting_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "soba"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soba"."form_submitter_setting" ADD CONSTRAINT "form_submitter_setting_form_id_form_id_fk" FOREIGN KEY ("form_id") REFERENCES "soba"."form"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "form_submitter_setting_form_uq" ON "soba"."form_submitter_setting" ("form_id");--> statement-breakpoint
CREATE INDEX "form_submitter_setting_workspace_idx" ON "soba"."form_submitter_setting" ("workspace_id");--> statement-breakpoint
INSERT INTO "soba"."form_submitter_setting" ("id", "workspace_id", "form_id", "created_by", "updated_by")
SELECT gen_random_uuid(), "workspace_id", "id", 'SOBA System (migration)', 'SOBA System (migration)'
FROM "soba"."form"
WHERE "deleted_at" IS NULL;
