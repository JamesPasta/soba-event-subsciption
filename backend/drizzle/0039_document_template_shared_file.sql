DROP INDEX "soba"."document_template_file_uq";--> statement-breakpoint
CREATE INDEX "document_template_file_idx" ON "soba"."document_template" ("file_id");
