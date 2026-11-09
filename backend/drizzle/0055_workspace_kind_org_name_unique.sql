DROP INDEX "soba"."workspace_kind_name_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_kind_org_name_uq" ON "soba"."workspace" ("kind","org",lower("name"));
