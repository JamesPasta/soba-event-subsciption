CREATE TABLE "soba"."form_group_override" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"form_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "soba"."form_group_override_member" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"override_id" uuid NOT NULL,
	"member_kind" text NOT NULL,
	"workspace_membership_id" uuid,
	"identity_provider_code" text,
	"idp_group_code" text,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	CONSTRAINT "form_group_override_member_member_kind_check" CHECK (
		("member_kind" = 'user' AND "workspace_membership_id" IS NOT NULL AND "identity_provider_code" IS NULL AND "idp_group_code" IS NULL)
		OR ("member_kind" = 'idp' AND "workspace_membership_id" IS NULL AND "identity_provider_code" IS NOT NULL AND "idp_group_code" IS NULL)
		OR ("member_kind" = 'idp_group' AND "workspace_membership_id" IS NULL AND "identity_provider_code" IS NULL AND "idp_group_code" IS NOT NULL)
	)
);
--> statement-breakpoint
ALTER TABLE "soba"."form_group_override" ADD CONSTRAINT "form_group_override_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "soba"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soba"."form_group_override" ADD CONSTRAINT "form_group_override_form_id_form_id_fk" FOREIGN KEY ("form_id") REFERENCES "soba"."form"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soba"."form_group_override" ADD CONSTRAINT "form_group_override_group_id_workspace_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "soba"."workspace_group"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soba"."form_group_override_member" ADD CONSTRAINT "form_group_override_member_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "soba"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soba"."form_group_override_member" ADD CONSTRAINT "form_group_override_member_override_id_fk" FOREIGN KEY ("override_id") REFERENCES "soba"."form_group_override"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soba"."form_group_override_member" ADD CONSTRAINT "form_group_override_member_membership_fk" FOREIGN KEY ("workspace_membership_id") REFERENCES "soba"."workspace_membership"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soba"."form_group_override_member" ADD CONSTRAINT "form_group_override_member_idp_code_fk" FOREIGN KEY ("identity_provider_code") REFERENCES "soba"."identity_provider"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soba"."form_group_override_member" ADD CONSTRAINT "form_group_override_member_idp_group_code_fk" FOREIGN KEY ("idp_group_code") REFERENCES "soba"."idp_group"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "form_group_override_form_group_uq" ON "soba"."form_group_override" ("form_id","group_id") WHERE "status" = 'active';--> statement-breakpoint
CREATE INDEX "form_group_override_workspace_idx" ON "soba"."form_group_override" ("workspace_id");--> statement-breakpoint
CREATE INDEX "form_group_override_form_idx" ON "soba"."form_group_override" ("form_id");--> statement-breakpoint
CREATE INDEX "form_group_override_group_idx" ON "soba"."form_group_override" ("group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "form_group_override_member_user_uq" ON "soba"."form_group_override_member" ("override_id","workspace_membership_id") WHERE "member_kind" = 'user';--> statement-breakpoint
CREATE UNIQUE INDEX "form_group_override_member_idp_uq" ON "soba"."form_group_override_member" ("override_id","identity_provider_code") WHERE "member_kind" = 'idp';--> statement-breakpoint
CREATE UNIQUE INDEX "form_group_override_member_idp_group_uq" ON "soba"."form_group_override_member" ("override_id","idp_group_code") WHERE "member_kind" = 'idp_group';--> statement-breakpoint
CREATE INDEX "form_group_override_member_workspace_idx" ON "soba"."form_group_override_member" ("workspace_id");--> statement-breakpoint
CREATE INDEX "form_group_override_member_override_idx" ON "soba"."form_group_override_member" ("override_id");--> statement-breakpoint
CREATE INDEX "form_group_override_member_membership_idx" ON "soba"."form_group_override_member" ("workspace_membership_id");
