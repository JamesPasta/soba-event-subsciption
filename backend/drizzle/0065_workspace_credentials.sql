CREATE UNIQUE INDEX "form_workspace_id_uq" ON "soba"."form" ("workspace_id","id");--> statement-breakpoint
CREATE TABLE "soba"."workspace_credential" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"form_id" uuid,
	"issuer_code" text NOT NULL,
	"client_id" text,
	"flow" text,
	"label" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"status" text NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_at" timestamp with time zone,
	CONSTRAINT "workspace_credential_status_check" CHECK ("status" IN ('issuing', 'active', 'rotating', 'unknown'))
);
--> statement-breakpoint
ALTER TABLE "soba"."workspace_credential" ADD CONSTRAINT "workspace_credential_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "soba"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soba"."workspace_credential" ADD CONSTRAINT "workspace_credential_form_workspace_fk" FOREIGN KEY ("workspace_id","form_id") REFERENCES "soba"."form"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_credential_workspace_idx" ON "soba"."workspace_credential" ("workspace_id");--> statement-breakpoint
CREATE INDEX "workspace_credential_form_idx" ON "soba"."workspace_credential" ("form_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_credential_consumer_uq" ON "soba"."workspace_credential" ("issuer_code","client_id");--> statement-breakpoint
CREATE TABLE "soba"."credential_audit" (
	"id" uuid PRIMARY KEY NOT NULL,
	"credential_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "soba"."credential_audit" ADD CONSTRAINT "credential_audit_credential_id_workspace_credential_id_fk" FOREIGN KEY ("credential_id") REFERENCES "soba"."workspace_credential"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE TABLE "soba"."credential_type" (
	"code" text PRIMARY KEY NOT NULL,
	CONSTRAINT "credential_type_code_check" CHECK ("code" IN ('api', 'web-component'))
);
--> statement-breakpoint
INSERT INTO "soba"."credential_type" ("code") VALUES ('api'), ('web-component');--> statement-breakpoint
CREATE TABLE "soba"."credential_type_assignment" (
	"credential_id" uuid NOT NULL,
	"type_code" text NOT NULL,
	CONSTRAINT "credential_type_assignment_credential_id_type_code_pk" PRIMARY KEY("credential_id","type_code")
);
--> statement-breakpoint
ALTER TABLE "soba"."credential_type_assignment" ADD CONSTRAINT "credential_type_assignment_credential_id_workspace_credential_id_fk" FOREIGN KEY ("credential_id") REFERENCES "soba"."workspace_credential"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soba"."credential_type_assignment" ADD CONSTRAINT "credential_type_assignment_type_code_credential_type_code_fk" FOREIGN KEY ("type_code") REFERENCES "soba"."credential_type"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credential_type_assignment_type_idx" ON "soba"."credential_type_assignment" ("type_code");
