-- Every existing template is a CDOGS template. The default stays so a pod still on the previous
-- release can insert during a rolling upgrade.
ALTER TABLE "soba"."document_template" ADD COLUMN "type" text DEFAULT 'cdogs' NOT NULL;--> statement-breakpoint
ALTER TABLE "soba"."document_template" ADD CONSTRAINT "document_template_type_check" CHECK ("type" IN ('cdogs'));--> statement-breakpoint

-- A version may already hold several templates. The most recently updated one of each type stays;
-- the others go, with any file row only they used. Those files' stored bytes stay in storage.
CREATE TEMP TABLE "document_template_removed" ON COMMIT DROP AS
SELECT "id", "file_id" FROM (
	SELECT "id", "file_id", row_number() OVER (
		PARTITION BY "form_version_id", "type" ORDER BY "updated_at" DESC, "id" DESC
	) AS "rank"
	FROM "soba"."document_template"
) AS "ranked"
WHERE "rank" > 1;--> statement-breakpoint
DELETE FROM "soba"."document_template"
WHERE "id" IN (SELECT "id" FROM "document_template_removed");--> statement-breakpoint
DELETE FROM "soba"."file" AS "f"
WHERE "f"."id" IN (SELECT "file_id" FROM "document_template_removed")
	AND NOT EXISTS (SELECT 1 FROM "soba"."document_template" AS "t" WHERE "t"."file_id" = "f"."id");--> statement-breakpoint

DROP INDEX "soba"."document_template_version_name_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "document_template_version_type_uq" ON "soba"."document_template" ("form_version_id","type");
