CREATE TABLE "soba"."role_audit" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"role_code" text NOT NULL,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"actor_id" uuid NOT NULL,
	"actor_display_label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_audit_action_check" CHECK ("action" IN ('create', 'update', 'delete'))
);
--> statement-breakpoint
ALTER TABLE "soba"."role_audit" ADD CONSTRAINT "role_audit_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "soba"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soba"."role_audit" ADD CONSTRAINT "role_audit_role_code_role_code_fk" FOREIGN KEY ("role_code") REFERENCES "soba"."role"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "role_audit_workspace_idx" ON "soba"."role_audit" ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "role_audit_role_idx" ON "soba"."role_audit" ("role_code","created_at");
