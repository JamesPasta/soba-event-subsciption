DELETE FROM "soba"."workspace_group_membership" WHERE "member_kind" IN ('idp', 'idp_group');--> statement-breakpoint
DELETE FROM "soba"."form_group_override_member" WHERE "member_kind" IN ('idp', 'idp_group');--> statement-breakpoint
UPDATE "soba"."form_group_override" o
SET "status" = 'inactive', "updated_by" = 'SOBA System (migration)', "updated_at" = now()
FROM "soba"."workspace_group" g
WHERE o."group_id" = g."id" AND g."system_code" = 'form_submitters' AND o."status" = 'active'
	AND NOT EXISTS (
		SELECT 1 FROM "soba"."form_group_override_member" m
		WHERE m."override_id" = o."id" AND m."status" = 'active'
	);
