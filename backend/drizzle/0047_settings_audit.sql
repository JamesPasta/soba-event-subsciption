CREATE TABLE "soba"."settings_audit" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"form_id" uuid,
	"group_key" text NOT NULL,
	"version" integer NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"actor_id" uuid,
	"actor_display_label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "soba"."settings_audit" ADD CONSTRAINT "settings_audit_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "soba"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soba"."settings_audit" ADD CONSTRAINT "settings_audit_form_id_form_id_fk" FOREIGN KEY ("form_id") REFERENCES "soba"."form"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "settings_audit_workspace_idx" ON "soba"."settings_audit" ("workspace_id", "created_at");--> statement-breakpoint
CREATE INDEX "settings_audit_form_idx" ON "soba"."settings_audit" ("form_id", "created_at");
