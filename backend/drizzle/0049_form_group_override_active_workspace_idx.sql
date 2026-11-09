CREATE INDEX "form_group_override_active_workspace_idx" ON "soba"."form_group_override" ("workspace_id","form_id") WHERE "status" = 'active';
