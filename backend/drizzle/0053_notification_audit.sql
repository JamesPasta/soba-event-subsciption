CREATE TABLE "soba"."notification_audit" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"form_id" uuid,
	"submission_id" uuid,
	"plugin_code" text NOT NULL,
	"channel" text NOT NULL,
	"outcome" text NOT NULL,
	"recipients" jsonb NOT NULL,
	"subject" text,
	"provider_message_id" text,
	"provider_status" text,
	"http_status" integer,
	"error_detail" text,
	"duration_ms" integer NOT NULL,
	"request_id" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "soba"."notification_audit" ADD CONSTRAINT "notification_audit_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "soba"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soba"."notification_audit" ADD CONSTRAINT "notification_audit_form_id_form_id_fk" FOREIGN KEY ("form_id") REFERENCES "soba"."form"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soba"."notification_audit" ADD CONSTRAINT "notification_audit_submission_id_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "soba"."submission"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soba"."notification_audit" ADD CONSTRAINT "notification_audit_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "soba"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_audit_workspace_created_idx" ON "soba"."notification_audit" ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "notification_audit_form_created_idx" ON "soba"."notification_audit" ("form_id","created_at");--> statement-breakpoint
CREATE INDEX "notification_audit_submission_idx" ON "soba"."notification_audit" ("submission_id");--> statement-breakpoint
INSERT INTO "soba"."feature" ("code","name","description","version","status","availability","created_by","updated_by") VALUES
	('notifications','Notifications','Sending email through the active notification plugin',NULL,'disabled','fixed','SOBA System (seed)','SOBA System (seed)')
ON CONFLICT DO NOTHING;
