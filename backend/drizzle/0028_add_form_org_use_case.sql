ALTER TABLE "soba"."form" ADD COLUMN "org" text;
ALTER TABLE "soba"."form" ADD COLUMN "use_case" text;

UPDATE "soba"."form"
SET "org" = w."org",
    "use_case" = w."use_case"
FROM "soba"."workspace" w
WHERE "soba"."form"."workspace_id" = w."id";

ALTER TABLE "soba"."form" ALTER COLUMN "org" SET NOT NULL;
ALTER TABLE "soba"."form" ALTER COLUMN "use_case" SET NOT NULL;
