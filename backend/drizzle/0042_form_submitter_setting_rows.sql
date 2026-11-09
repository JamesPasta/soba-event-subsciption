INSERT INTO "soba"."form_submitter_setting" ("id", "workspace_id", "form_id", "created_by", "updated_by")
SELECT gen_random_uuid(), f."workspace_id", f."id", 'SOBA System (migration)', 'SOBA System (migration)'
FROM "soba"."form" f
WHERE f."deleted_at" IS NULL
	AND NOT EXISTS (SELECT 1 FROM "soba"."form_submitter_setting" s WHERE s."form_id" = f."id");
