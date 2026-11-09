ALTER TABLE "soba"."notification_audit" ADD COLUMN "job_id" uuid;--> statement-breakpoint
CREATE INDEX "notification_audit_job_idx" ON "soba"."notification_audit" ("job_id");--> statement-breakpoint
CREATE INDEX "notification_audit_created_idx" ON "soba"."notification_audit" ("created_at");--> statement-breakpoint
INSERT INTO "soba"."feature" ("code","name","description","version","status","availability","created_by","updated_by") VALUES
	('post-submission-email','Post-submission email','Emailing a notice to a list of addresses when a form receives a submission',NULL,'disabled','scoped','SOBA System (seed)','SOBA System (seed)')
ON CONFLICT DO NOTHING;
