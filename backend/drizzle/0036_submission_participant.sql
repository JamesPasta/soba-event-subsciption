CREATE TABLE "soba"."submission_participant" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"status" text NOT NULL,
	"granted_by" uuid NOT NULL,
	"revoked_by" uuid,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	CONSTRAINT "submission_participant_role_check" CHECK ("role" IN ('owner', 'collaborator')),
	CONSTRAINT "submission_participant_status_check" CHECK (
		("status" = 'active' AND "revoked_by" IS NULL AND "revoked_at" IS NULL)
		OR ("status" = 'inactive' AND "revoked_by" IS NOT NULL AND "revoked_at" IS NOT NULL)
	)
);
--> statement-breakpoint
ALTER TABLE "soba"."submission_participant" ADD CONSTRAINT "submission_participant_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "soba"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soba"."submission_participant" ADD CONSTRAINT "submission_participant_submission_id_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "soba"."submission"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soba"."submission_participant" ADD CONSTRAINT "submission_participant_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "soba"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soba"."submission_participant" ADD CONSTRAINT "submission_participant_granted_by_app_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "soba"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soba"."submission_participant" ADD CONSTRAINT "submission_participant_revoked_by_app_user_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "soba"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "submission_participant_submission_user_uq" ON "soba"."submission_participant" ("submission_id","user_id") WHERE "status" = 'active';--> statement-breakpoint
CREATE INDEX "submission_participant_user_active_idx" ON "soba"."submission_participant" ("user_id") WHERE "status" = 'active';--> statement-breakpoint
CREATE INDEX "submission_participant_submission_idx" ON "soba"."submission_participant" ("submission_id");--> statement-breakpoint
CREATE INDEX "submission_participant_workspace_idx" ON "soba"."submission_participant" ("workspace_id");--> statement-breakpoint

-- Each existing submission is owned by its revision-0 opener, or by submitted_by when it has no
-- revision-0 `opened` event. A submission that records neither gets no owner.
INSERT INTO "soba"."submission_participant"
	("id", "workspace_id", "submission_id", "user_id", "role", "status", "granted_by", "created_at", "created_by", "updated_by")
SELECT gen_random_uuid(), s."workspace_id", s."id", COALESCE(r."changed_by", s."submitted_by"), 'owner', 'active',
	COALESCE(r."changed_by", s."submitted_by"), s."created_at", 'SOBA System (migration)', 'SOBA System (migration)'
FROM "soba"."submission" s
LEFT JOIN "soba"."submission_revision" r ON r."workspace_id" = s."workspace_id" AND r."submission_id" = s."id"
	AND r."revision_no" = 0 AND r."event_type" = 'opened'
WHERE COALESCE(r."changed_by", s."submitted_by") IS NOT NULL;
