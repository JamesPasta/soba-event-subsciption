ALTER TABLE "soba"."submission_revision" ADD COLUMN "parent_revision_id" uuid;
ALTER TABLE "soba"."submission" ADD COLUMN "head_revision_id" uuid;

ALTER TABLE "soba"."submission_revision" ADD CONSTRAINT "submission_revision_parent_revision_id_fk" FOREIGN KEY ("parent_revision_id") REFERENCES "soba"."submission_revision"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "soba"."submission" ADD CONSTRAINT "submission_head_revision_id_fk" FOREIGN KEY ("head_revision_id") REFERENCES "soba"."submission_revision"("id") ON DELETE no action ON UPDATE no action;

CREATE INDEX "submission_revision_parent_idx" ON "soba"."submission_revision" USING btree ("parent_revision_id");
CREATE INDEX "submission_head_revision_idx" ON "soba"."submission" USING btree ("head_revision_id");

UPDATE "soba"."submission_revision" r
SET "parent_revision_id" = p."id"
FROM "soba"."submission_revision" p
WHERE p."workspace_id" = r."workspace_id"
  AND p."submission_id" = r."submission_id"
  AND p."revision_no" = r."revision_no" - 1;

UPDATE "soba"."submission" s
SET "head_revision_id" = r."id"
FROM "soba"."submission_revision" r
WHERE r."workspace_id" = s."workspace_id"
  AND r."submission_id" = s."id"
  AND r."revision_no" = s."current_revision_no";
