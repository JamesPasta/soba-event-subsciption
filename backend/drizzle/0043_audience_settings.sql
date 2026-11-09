CREATE TABLE "soba"."workspace_audience_setting" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"idps" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	CONSTRAINT "workspace_audience_setting_mode_check" CHECK ("mode" IN ('public', 'protected', 'members')),
	CONSTRAINT "workspace_audience_setting_idps_check" CHECK (("mode" = 'protected') = (cardinality("idps") > 0))
);
--> statement-breakpoint
CREATE TABLE "soba"."form_audience_setting" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"form_id" uuid NOT NULL,
	"inherit" boolean DEFAULT true NOT NULL,
	"mode" text,
	"idps" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	CONSTRAINT "form_audience_setting_mode_check" CHECK ("mode" IN ('public', 'protected', 'members')),
	CONSTRAINT "form_audience_setting_inherit_check" CHECK (
		("inherit" AND "mode" IS NULL AND "idps" IS NULL)
		OR (NOT "inherit" AND "mode" IS NOT NULL AND "idps" IS NOT NULL)
	),
	CONSTRAINT "form_audience_setting_idps_check" CHECK (("mode" = 'protected') = (cardinality("idps") > 0))
);
--> statement-breakpoint
ALTER TABLE "soba"."workspace_audience_setting" ADD CONSTRAINT "workspace_audience_setting_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "soba"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soba"."form_audience_setting" ADD CONSTRAINT "form_audience_setting_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "soba"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soba"."form_audience_setting" ADD CONSTRAINT "form_audience_setting_form_id_form_id_fk" FOREIGN KEY ("form_id") REFERENCES "soba"."form"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_audience_setting_workspace_uq" ON "soba"."workspace_audience_setting" ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "form_audience_setting_form_uq" ON "soba"."form_audience_setting" ("form_id");--> statement-breakpoint
CREATE INDEX "form_audience_setting_workspace_idx" ON "soba"."form_audience_setting" ("workspace_id");--> statement-breakpoint
INSERT INTO "soba"."workspace_audience_setting" ("id", "workspace_id", "mode", "idps", "created_by", "updated_by")
SELECT gen_random_uuid(), w."id",
	CASE
		WHEN bool_or(m."identity_provider_code" = 'public') THEN 'public'
		WHEN count(m."id") > 0 THEN 'protected'
		ELSE 'members'
	END,
	CASE
		WHEN bool_or(m."identity_provider_code" = 'public') THEN '{}'::text[]
		ELSE coalesce(array_agg(m."identity_provider_code" ORDER BY m."identity_provider_code") FILTER (WHERE m."id" IS NOT NULL), '{}'::text[])
	END,
	'SOBA System (migration)', 'SOBA System (migration)'
FROM "soba"."workspace" w
LEFT JOIN "soba"."workspace_group" g
	ON g."workspace_id" = w."id" AND g."system_code" = 'form_submitters' AND g."status" = 'active'
LEFT JOIN "soba"."workspace_group_membership" m
	ON m."group_id" = g."id" AND m."member_kind" = 'idp' AND m."status" = 'active'
GROUP BY w."id";--> statement-breakpoint
INSERT INTO "soba"."form_audience_setting" ("id", "workspace_id", "form_id", "inherit", "mode", "idps", "created_by", "updated_by")
SELECT gen_random_uuid(), f."workspace_id", f."id", o."id" IS NULL,
	CASE
		WHEN o."id" IS NULL THEN NULL
		WHEN bool_or(m."identity_provider_code" = 'public') THEN 'public'
		WHEN count(m."id") > 0 THEN 'protected'
		ELSE 'members'
	END,
	CASE
		WHEN o."id" IS NULL THEN NULL
		WHEN bool_or(m."identity_provider_code" = 'public') THEN '{}'::text[]
		ELSE coalesce(array_agg(m."identity_provider_code" ORDER BY m."identity_provider_code") FILTER (WHERE m."id" IS NOT NULL), '{}'::text[])
	END,
	'SOBA System (migration)', 'SOBA System (migration)'
FROM "soba"."form" f
LEFT JOIN "soba"."workspace_group" g
	ON g."workspace_id" = f."workspace_id" AND g."system_code" = 'form_submitters' AND g."status" = 'active'
LEFT JOIN "soba"."form_group_override" o
	ON o."form_id" = f."id" AND o."group_id" = g."id" AND o."status" = 'active'
LEFT JOIN "soba"."form_group_override_member" m
	ON m."override_id" = o."id" AND m."member_kind" = 'idp' AND m."status" = 'active'
WHERE f."deleted_at" IS NULL
GROUP BY f."id", f."workspace_id", o."id";
