-- Catalog only. Not granted to any role: form_admin already matches via `*`.
-- form_designer keeps design_create for new designs on existing forms.
INSERT INTO "soba"."permission" ("code","name","description","status","source","feature_code","created_by","updated_by") VALUES
	('form_create','Create form','Can create a form','active','core',NULL,'SOBA System (seed)','SOBA System (seed)')
ON CONFLICT DO NOTHING;
