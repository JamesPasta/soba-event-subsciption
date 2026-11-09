LOCK TABLE "soba"."form_version" IN SHARE ROW EXCLUSIVE MODE;--> statement-breakpoint
UPDATE "soba"."form_version" v
SET "state" = 'archived', "published_at" = NULL, "published_by" = NULL,
	"updated_at" = now(), "updated_by" = 'SOBA System (migration)'
WHERE v."state" = 'published' AND v."deleted_at" IS NULL
	AND EXISTS (
		SELECT 1 FROM "soba"."form_version" n
		WHERE n."form_id" = v."form_id" AND n."state" = 'published' AND n."deleted_at" IS NULL
			AND (coalesce(n."published_at", '-infinity'), n."version_no", n."id")
				> (coalesce(v."published_at", '-infinity'), v."version_no", v."id")
	);--> statement-breakpoint
CREATE UNIQUE INDEX "form_version_one_published_uq" ON "soba"."form_version" ("form_id") WHERE "state" = 'published' AND "deleted_at" IS NULL;
