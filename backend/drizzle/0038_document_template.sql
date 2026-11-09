CREATE TABLE "soba"."document_template" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"form_id" uuid NOT NULL,
	"form_version_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text
);
--> statement-breakpoint
ALTER TABLE "soba"."document_template" ADD CONSTRAINT "document_template_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "soba"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soba"."document_template" ADD CONSTRAINT "document_template_form_id_form_id_fk" FOREIGN KEY ("form_id") REFERENCES "soba"."form"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soba"."document_template" ADD CONSTRAINT "document_template_form_version_id_form_version_id_fk" FOREIGN KEY ("form_version_id") REFERENCES "soba"."form_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soba"."document_template" ADD CONSTRAINT "document_template_file_id_file_id_fk" FOREIGN KEY ("file_id") REFERENCES "soba"."file"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_template_file_uq" ON "soba"."document_template" ("file_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_template_version_name_uq" ON "soba"."document_template" ("form_version_id","name");--> statement-breakpoint
CREATE INDEX "document_template_workspace_idx" ON "soba"."document_template" ("workspace_id");--> statement-breakpoint
INSERT INTO "soba"."feature" ("code","name","description","version","status","availability","created_by","updated_by") VALUES
	('templates','Templates','Document templates stored per form version, managed by staff',NULL,'enabled','fixed','SOBA System (seed)','SOBA System (seed)')
ON CONFLICT DO NOTHING;
