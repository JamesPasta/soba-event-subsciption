CREATE TABLE "soba"."workspace_submitter_setting" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"allow_submitter_drafts" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text
);
--> statement-breakpoint
ALTER TABLE "soba"."workspace_submitter_setting" ADD CONSTRAINT "workspace_submitter_setting_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "soba"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_submitter_setting_workspace_uq" ON "soba"."workspace_submitter_setting" ("workspace_id");--> statement-breakpoint
INSERT INTO "soba"."workspace_submitter_setting" ("id", "workspace_id", "created_by", "updated_by")
SELECT gen_random_uuid(), w."id", 'SOBA System (migration)', 'SOBA System (migration)'
FROM "soba"."workspace" w;--> statement-breakpoint
ALTER TABLE "soba"."form_submitter_setting" ADD COLUMN "inherit" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "soba"."form_submitter_setting" ALTER COLUMN "allow_submitter_drafts" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "soba"."form_submitter_setting" ALTER COLUMN "allow_submitter_drafts" DROP NOT NULL;--> statement-breakpoint
UPDATE "soba"."form_submitter_setting" SET "inherit" = false WHERE "allow_submitter_drafts";--> statement-breakpoint
UPDATE "soba"."form_submitter_setting" SET "allow_submitter_drafts" = NULL WHERE "inherit";--> statement-breakpoint
ALTER TABLE "soba"."form_submitter_setting" ADD CONSTRAINT "form_submitter_setting_inherit_check" CHECK (
	("inherit" AND "allow_submitter_drafts" IS NULL)
	OR (NOT "inherit" AND "allow_submitter_drafts" IS NOT NULL)
);
