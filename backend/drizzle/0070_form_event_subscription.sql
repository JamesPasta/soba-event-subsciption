CREATE TABLE "soba"."form_event_subscription" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"form_id" uuid NOT NULL,
	"endpoint_url" text DEFAULT '' NOT NULL,
	"key" text DEFAULT '' NOT NULL,
	"encrypted_token" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text
);
--> statement-breakpoint
ALTER TABLE "soba"."form_event_subscription" ADD CONSTRAINT "form_event_subscription_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "soba"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soba"."form_event_subscription" ADD CONSTRAINT "form_event_subscription_form_id_form_id_fk" FOREIGN KEY ("form_id") REFERENCES "soba"."form"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "form_event_subscription_form_uq" ON "soba"."form_event_subscription" ("form_id");--> statement-breakpoint
CREATE INDEX "form_event_subscription_workspace_idx" ON "soba"."form_event_subscription" ("workspace_id");--> statement-breakpoint
INSERT INTO "soba"."form_event_subscription" ("id", "workspace_id", "form_id", "created_by", "updated_by")
SELECT gen_random_uuid(), "workspace_id", "id", 'SOBA System (migration)', 'SOBA System (migration)'
FROM "soba"."form"
WHERE "deleted_at" IS NULL;
