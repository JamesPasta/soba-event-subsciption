# How to add a form settings group

A worked guide for a group a form owns alone, then the extra pieces for a group a workspace shares
with its forms ([Shared groups](#shared-groups)). Replace `<group>` with your group's name
throughout. The groups that ship today, `audience`, `submitter` and `review`, are shared; the
submitter files are the reference copy, and `review` shows a group with more than one flag.

For what the pieces are and how they fit, see [Form settings](form-settings.md).

## Before you start

- **Adding a flag to an existing group?** See the [last section](#adding-a-flag-to-an-existing-group).
- **Pick the group name.** It becomes the URL segment (`/design/forms/:id/settings/<group>`), the
  table name (`form_<group>_setting`), the SWR key and the OpenAPI component prefix.
- **Decide the defaults.** Every flag is a typed column with a `NOT NULL DEFAULT`. That default is
  the only one: no code supplies a fallback.
- **Decide the feature.** A group can be always on, part of an existing feature, or behind its own.

## 1. Migration

`backend/drizzle/NNNN_form_<group>_setting.sql`, modelled on `0034_form_submitter_setting.sql`:

```sql
CREATE TABLE "soba"."form_<group>_setting" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"form_id" uuid NOT NULL,
	"<flag>" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text
);
--> statement-breakpoint
-- foreign keys to workspace and form, a unique index on form_id, an index on workspace_id
--> statement-breakpoint
INSERT INTO "soba"."form_<group>_setting" ("id", "workspace_id", "form_id", "created_by", "updated_by")
SELECT gen_random_uuid(), "workspace_id", "id", 'SOBA System (migration)', 'SOBA System (migration)'
FROM "soba"."form"
WHERE "deleted_at" IS NULL;
```

Add the journal entry in `backend/drizzle/meta/_journal.json` with a `when` higher than every
migration already merged. The migrator applies an entry only when its `when` is newer than the last
applied one, so a migration that reaches an environment out of order is skipped silently.

The backfill covers live forms; forms created later get their row when they are created (step 4).

## 2. Drizzle table

`backend/src/core/db/schema/form<Group>Setting.ts`, following `formSubmitterSetting.ts`: `idColumn()`,
`workspace_id` and `form_id` references, the typed flag columns,
`version: integer('version').notNull().default(1)`, `auditColumns()`, a unique index on `formId` and
an index on `workspaceId`. Export it from `backend/src/core/db/schema/index.ts`.

The table lives here, not in the module, because the schema index is what the migration tooling, the
database client and the purge coverage test read.

## 3. Lib schemas

`lib/src/schemas/formSettings/<group>.ts`:

```ts
import { z } from 'zod';
import { SettingsVersionSchema } from './inheritable';

/** URL segment of the group, shared by the route, the SWR key and the OpenAPI component names. */
export const <GROUP>_SETTINGS_KEY = '<group>';

export const <Group>SettingsSchema = z.object({
  <flag>: z.boolean(),
});

/** A form's group as read and as saved: every setting, and the version a save started from. */
export const Form<Group>SettingsSchema = z.strictObject({
  values: <Group>SettingsSchema,
  version: SettingsVersionSchema,
});

export type <Group>Settings = z.infer<typeof <Group>SettingsSchema>;
export type Form<Group>Settings = z.infer<typeof Form<Group>SettingsSchema>;
```

Export it from `lib/src/schemas/formSettings/index.ts`, and add a test beside
`lib/tests/schemas/formSettings/submitter.test.ts` covering a valid body, a missing version, and a
missing or mistyped flag.

## 4. Backend module

`backend/src/features/form-settings/<group>/`, four files:

- **`repo.ts`**: `create<Group>Settings`, `find<Group>Settings`, `update<Group>Settings`. `create`
  takes the transaction that creates the form and inserts the row, so its values come from the
  column defaults.
- **`service.ts`**: implements `FormSettingsService<TSettings, TBody>` from `../routes`. `get` finds
  the row and returns its `version`; `set` writes it through `saveSettingsRow`
  (`core/db/repos/settingsRow.ts`) with the version the body names and the audit entry (group key,
  workspace, form, actor), and `assertSaved` turns a missed save into a 404 (no row) or a 409 (the
  row moved on). A save of the values already stored writes nothing. Other features read the group
  through this service, never through its table.
- **`openapi.ts`**: the OpenAPI clones, with the key from the lib schema:

```ts
export const Form<Group>SettingsSchema =
  LibForm<Group>SettingsSchema.clone().openapi('FormSettings_Form<Group>');

export const register<Group>SettingsOpenApi: RegisterOpenApiPaths = (registry) =>
  registerSettingsPaths(registry, {
    key: <GROUP>_SETTINGS_KEY,
    label: '<group> settings',
    settingsSchema: Form<Group>SettingsSchema,
    bodySchema: Form<Group>SettingsSchema,
  });
```

- **`index.ts`**: the descriptor:

```ts
export const <group>SettingsModule: FormSettingsModule = {
  key: <GROUP>_SETTINGS_KEY,
  weight: 20,
  router: () => settingsRoutes(<group>SettingsService, Form<Group>SettingsSchema),
  registerOpenApi: register<Group>SettingsOpenApi,
  tables: [form<Group>Settings],
  createForForm: create<Group>Settings,
};
```

Add it to `backend/src/features/form-settings/registry.ts`. That is the only file outside the module
that changes: the mounting router, OpenAPI registration, form creation and dev-data purge all read
the registry.

`settingsRoutes` gives the group `GET` (needs `form_read`) and `PUT` (needs `form_update`, body
validated against the schema). Write your own router only if the group needs more than those two.

## 5. Frontend section

`frontend/src/features/form-settings/<group>/`, two files:

- **`<Group>SettingsDrawer.tsx`**: the section body, wrapped in `FormSettingsDrawers` (which
  supplies the accordion, Save and Cancel). Read and write with the generic hook:

```ts
const { settings, error, save } = useFormSettings<Form<Group>Settings, Form<Group>Settings>(
  <GROUP>_SETTINGS_KEY,
  formId,
);
```

Follow `SubmitterSettingsDrawer.tsx` for the rest: edits layered over the loaded value (null means
no edit), Save held off through `canSave` until there is an edit, a save guarded against double
clicks, the edit dropped with a message when the save gets a 409, a load-error alert built with
`messageForDataError`, controls disabled until the data is known, and a `data-testid` on every
control.

- **`index.ts`**: the descriptor:

```ts
export const <group>Section: FormSettingsSection = {
  id: '<group>-settings',
  weight: 40,
  Drawer: <Group>SettingsDrawer,
};
```

Add it to `frontend/src/features/form-settings/registry.ts`. Weights run 10 (Form Settings), 20
(Form Profile), 25 (Form Audience), 30 (Submitter Settings), 35 (Review Settings); leave gaps so a
later section can slot between. This weight orders the tab and is unrelated to the module's, which
orders mounting.

Add the section's text under `form.settings` in `frontend/dictionaries/en.json` and `fr.json`: the
section label, each control's label, and any note or load-error message.

## 6. Feature flag (optional)

| the group is                | backend                        | frontend                            |
| --------------------------- | ------------------------------ | ----------------------------------- |
| always on                   | omit `featureCode`             | omit `featureCode`                  |
| part of an existing feature | `featureCode: Features.<code>` | `featureCode: FEATURE_CODES.<CODE>` |
| behind a `scoped` feature   | same                           | also `scoped: true`                 |

With a `featureCode`, the group's routes return 404 wherever the feature is unavailable for that
form, and the section is hidden. A `scoped` feature is granted per workspace or form, so the section
asks the server about this form; anything that fails to answer hides the section.

## 7. Tests

- **Lib:** the schema test from step 3.
- **Frontend:** a section test beside
  `frontend/tests/features/form-settings/submitter/SubmitterSettingsDrawer.test.tsx`, covering the
  saved value, a save, a failed save, a failed read, and whatever gating the section has.
- **Backend:** the shared routes helper and the registry are covered once, in
  `backend/tests/features/form-settings`. A group adds no all-mock service tests of its own: cover
  its repo and service with a throwaway script against the local database (see step 8) and delete it
  afterwards.
- The purge coverage test fails if the new table is not reachable from the registry, which is the
  reminder that the module's `tables` list is missing it.

## 8. Verify

From a terminal in the devcontainer, at the repo root (`/workspaces/soba`):

```bash
pnpm db:migrate
```

```bash
pnpm build:lib && pnpm test:lib
```

```bash
pnpm check:backend && pnpm test:backend
```

```bash
pnpm check:frontend && pnpm test:frontend
```

Then a throwaway script against the local database for: the backfill, a new form getting its row
with the defaults, a read, a save, a save of unchanged values (same version, no audit row), a save
from an older version (409), and an unknown form (404). Finish in the browser: the
section appears in the right place, saves, and survives a reload.

## Shared groups

A shared group has a workspace row as well, and each form either inherits it or keeps its own
values. On top of the steps above:

- The migration adds a `workspace_<group>_setting` table (unique `workspace_id`, flag columns with
  `NOT NULL DEFAULT`, `version`) backfilled for every workspace. The form table adds
  `inherit boolean DEFAULT true NOT NULL`, its flag columns are nullable with no default, and a
  `CHECK` keeps them null exactly while `inherit` is true. See `0045_submitter_settings_shared.sql`.
- In lib, `inheritableSettingsSchemas(<Group>SettingsSchema)` gives the workspace's
  `{ values, version }`, the form's view (`inherit`, `own`, `workspace`, `effective`, `version`), the
  form's save body (`{ inherit: true, version }` or `{ inherit: false, values, version }`) and the
  create choice, which has no version. It takes the place of `Form<Group>SettingsSchema` in step 3.
- The repo reads the form row joined to its workspace's in one query, and a save with `inherit`
  clears the form's own values. The workspace row has its own create, find and update.
- The form service returns `toInheritableSettings(row, row.workspace)`; a workspace service serves
  the workspace's `{ values, version }`. Other features read `effective`.
- For OpenAPI, `inheritableOpenApiSchemas(<Group>SettingsSchema, '<Group>')` and
  `registerInheritableSettingsPaths` name the values component once and register both scopes.
- The descriptor's form router validates against the `formBody` schema. The descriptor also has
  `workspace: { router, createForWorkspace }`, that router from
  `settingsRoutes(workspaceService, workspaceSchema, 'workspace')`, and lists both tables in `tables`.
- To let a new form set the group when it is created, add the group's choice to
  `CreateFormSettingsSchema` in `lib/src/schemas/forms.ts`, and have `createForForm` insert
  `input.settings?.<group>` when it does not inherit, with an audit entry for `input.actorId`. See
  `createFormAudience`.
- The section holds the edit in `useInheritableEdit(settings)`; `InheritCheckbox` shows the inherit
  choice, and the group's controls show the workspace's values, disabled, while it is ticked. Save
  `edit.body()`, with Save held off until `edit.changed`. See `SubmitterSettingsDrawer.tsx`.

The workspace routes are `/workspaces/:id/settings/<group>`: any member reads, owners and admins
write.

## Adding a flag to an existing group

1. A migration adding the column, whose default fills every existing row:

   ```sql
   ALTER TABLE "soba"."form_<group>_setting" ADD COLUMN "<flag>" boolean DEFAULT false NOT NULL;
   ```

2. The column in the Drizzle table.
3. The field in the lib schema, and the mapping in the module's `service.ts` and `repo.ts`.
4. The control in the section, with its dictionary text and tests.

In a shared group the workspace column takes the `NOT NULL DEFAULT`, the form column is nullable,
and the form table's `CHECK` covers the new column too.

The endpoint, the registry and the section descriptor stay as they are.

## Gotchas

- **Defaults live in the database only.** No server code supplies a fallback; the row created with
  the form carries them. A section may still show a placeholder while the value loads.
- **`PUT` replaces the whole group.** The body carries every flag, so the section sends the values it
  loaded plus the change.
- **Saves name a version.** The body carries the version the section read. Let the 409 through to
  the section, which reads again and asks for the change again; never retry it with a fresh version.
  A save of the values already stored writes nothing and keeps the version.
- **Every creation path gets the rows.** `FormService.create` creates them, so do not insert a form
  any other way.
- **The group name is load-bearing.** It appears in the URL, the SWR key and the OpenAPI component
  names; changing it later is a breaking API change.
- **Migration order.** Merge the group's PR after any PR carrying a lower-numbered migration, and
  resolve `_journal.json` conflicts by keeping every entry in `idx` order.
