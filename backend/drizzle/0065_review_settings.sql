CREATE TABLE "soba"."workspace_review_setting" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"allow_status_updates" boolean DEFAULT false NOT NULL,
	"allow_submitter_revision" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text
);
--> statement-breakpoint
ALTER TABLE "soba"."workspace_review_setting" ADD CONSTRAINT "workspace_review_setting_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "soba"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_review_setting_workspace_uq" ON "soba"."workspace_review_setting" ("workspace_id");--> statement-breakpoint
INSERT INTO "soba"."workspace_review_setting" ("id", "workspace_id", "created_by", "updated_by")
SELECT gen_random_uuid(), w."id", 'SOBA System (migration)', 'SOBA System (migration)'
FROM "soba"."workspace" w;--> statement-breakpoint
CREATE TABLE "soba"."form_review_setting" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"form_id" uuid NOT NULL,
	"inherit" boolean DEFAULT true NOT NULL,
	"allow_status_updates" boolean,
	"allow_submitter_revision" boolean,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	CONSTRAINT "form_review_setting_inherit_check" CHECK (
		("inherit" AND "allow_status_updates" IS NULL AND "allow_submitter_revision" IS NULL)
		OR (NOT "inherit" AND "allow_status_updates" IS NOT NULL AND "allow_submitter_revision" IS NOT NULL)
	)
);
--> statement-breakpoint
ALTER TABLE "soba"."form_review_setting" ADD CONSTRAINT "form_review_setting_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "soba"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soba"."form_review_setting" ADD CONSTRAINT "form_review_setting_form_id_form_id_fk" FOREIGN KEY ("form_id") REFERENCES "soba"."form"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "form_review_setting_form_uq" ON "soba"."form_review_setting" ("form_id");--> statement-breakpoint
CREATE INDEX "form_review_setting_workspace_idx" ON "soba"."form_review_setting" ("workspace_id");--> statement-breakpoint
INSERT INTO "soba"."form_review_setting" ("id", "workspace_id", "form_id", "created_by", "updated_by")
SELECT gen_random_uuid(), "workspace_id", "id", 'SOBA System (migration)', 'SOBA System (migration)'
FROM "soba"."form"
WHERE "deleted_at" IS NULL;
