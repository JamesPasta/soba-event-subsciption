INSERT INTO "soba"."feature" ("code","name","description","version","status","availability","created_by","updated_by") VALUES
	('user-search','User search','Searching people to add to a workspace or a form''s team, across the enabled providers',NULL,'disabled','fixed','SOBA System (seed)','SOBA System (seed)')
ON CONFLICT DO NOTHING;
