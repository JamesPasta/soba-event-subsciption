CREATE INDEX "submission_form_submitted_idx" ON "soba"."submission" ("form_id","submitted_at","id") WHERE "deleted_at" is null;
