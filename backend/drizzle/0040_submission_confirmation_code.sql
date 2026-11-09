ALTER TABLE "soba"."submission" ADD COLUMN "confirmation_code" text;--> statement-breakpoint

-- Each existing submission gets a random code. Correlating on s."id" draws a new code per row.
UPDATE "soba"."submission" s SET "confirmation_code" = (
	SELECT string_agg(substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', 1 + floor(random() * 32)::int, 1), '')
	FROM generate_series(1, 8)
	WHERE s."id" IS NOT NULL
);--> statement-breakpoint

ALTER TABLE "soba"."submission" ALTER COLUMN "confirmation_code" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "soba"."submission" ADD CONSTRAINT "submission_confirmation_code_format_check" CHECK ("confirmation_code" ~ '^[0-9A-HJKMNP-TV-Z]{8}$');--> statement-breakpoint
CREATE UNIQUE INDEX "submission_confirmation_code_uq" ON "soba"."submission" ("confirmation_code");
