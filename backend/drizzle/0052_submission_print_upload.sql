INSERT INTO "soba"."permission" ("code","name","description","status","source","feature_code","created_by","updated_by") VALUES
	('submission_print_upload','Print with uploaded template','Can print a submission with a template uploaded for that print','active','core',NULL,'SOBA System (seed)','SOBA System (seed)')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "soba"."role_permission" ("role_code","permission_code") VALUES
	('submission_reviewer','submission_print_upload'),
	('submission_approver','submission_print_upload')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
ALTER TABLE "soba"."document_generation_audit" ADD COLUMN "template_id" uuid;--> statement-breakpoint
ALTER TABLE "soba"."document_generation_audit" ADD COLUMN "template_file_id" uuid;--> statement-breakpoint
ALTER TABLE "soba"."document_generation_audit" ADD COLUMN "revision_id" uuid;
