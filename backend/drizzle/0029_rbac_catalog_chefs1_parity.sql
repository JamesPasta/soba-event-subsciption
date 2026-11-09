INSERT INTO "soba"."permission" ("code","name","description","status","source","feature_code","created_by","updated_by") VALUES
	('document_template_create','Create document template','Can create document templates for a form','active','core',NULL,'SOBA System (seed)','SOBA System (seed)'),
	('document_template_read','Read document template','Can view document templates for a form','active','core',NULL,'SOBA System (seed)','SOBA System (seed)'),
	('document_template_delete','Delete document template','Can delete document templates for a form','active','core',NULL,'SOBA System (seed)','SOBA System (seed)')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "soba"."role" ("code","name","description","status","source","feature_code","created_by","updated_by") VALUES
	('team_manager','Team manager','Manages Team members for the workspace or form','active','core',NULL,'SOBA System (seed)','SOBA System (seed)')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "soba"."role_permission" ("role_code","permission_code") VALUES
	('team_manager','form_read'),
	('team_manager','team_read'),
	('team_manager','team_update'),
	('submission_reviewer','team_read'),
	('form_submitter','document_template_read')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "soba"."permission" AS p
SET "description" = v."description", "updated_at" = now(), "updated_by" = 'SOBA System (seed)'
FROM (VALUES
	('form_read','Can view the form (read-only)'),
	('form_update','Can edit/update the basic form metadata (not the design)'),
	('form_delete','Can delete the form'),
	('design_create','Can create a form design'),
	('design_read','Can view the form design (read-only)'),
	('design_update','Can edit/update the form design'),
	('design_delete','Can delete the form design'),
	('submission_create','Can fill out and submit this form'),
	('submission_read','Can view (all) form submissions (read-only)'),
	('submission_update','Can edit/update form submissions'),
	('submission_delete','Can delete form submissions'),
	('submission_review','Can add/read notes and update the status of a submission.'),
	('team_read','Can view the team members (read-only)'),
	('team_update','Can update the team members (add, remove)')
) AS v("code","description")
WHERE p."code" = v."code" AND p."description" IS NULL;
--> statement-breakpoint
UPDATE "soba"."role" AS r
SET "description" = v."description", "updated_at" = now(), "updated_by" = 'SOBA System (seed)'
FROM (VALUES
	('form_designer','Designs the form'),
	('form_submitter','Can fill out and submit the form'),
	('submission_reviewer','Can review and manage all form submissions'),
	('submission_approver','Can review all form submissions but can''t edit the submission.')
) AS v("code","description")
WHERE r."code" = v."code" AND r."description" IS NULL;
