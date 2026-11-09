INSERT INTO "soba"."role_status" ("code","display","sort_order","is_active") VALUES
	('inactive','Inactive',2,true)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
ALTER TABLE "soba"."role" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "soba"."role" ADD CONSTRAINT "role_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "soba"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soba"."role" ADD CONSTRAINT "role_workspace_source_check" CHECK (("source" = 'workspace') = ("workspace_id" IS NOT NULL));--> statement-breakpoint
CREATE UNIQUE INDEX "role_workspace_name_uq" ON "soba"."role" ("workspace_id","name") WHERE "status" = 'active';--> statement-breakpoint
ALTER TABLE "soba"."role_permission" ADD CONSTRAINT "role_permission_wildcard_check" CHECK ("permission_code" <> '*' OR "role_code" = 'form_admin');
