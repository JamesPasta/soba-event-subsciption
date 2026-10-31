ALTER TABLE "soba"."user_identity" ADD COLUMN "first_sign_in_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "soba"."user_identity" SET "first_sign_in_at" = "created_at" WHERE "idp_attributes" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "user_identity_provider_lower_subject_idx" ON "soba"."user_identity" ("identity_provider_code",lower("subject"));
