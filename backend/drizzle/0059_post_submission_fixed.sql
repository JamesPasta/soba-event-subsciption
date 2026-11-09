UPDATE "soba"."feature" SET "availability" = 'fixed', "updated_at" = now(), "updated_by" = 'SOBA System (seed)' WHERE "code" IN ('post-submission', 'post-submission-email');
