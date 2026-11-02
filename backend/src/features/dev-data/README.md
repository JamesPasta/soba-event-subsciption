# Development data

Builds a disposable data set for local development and integration testing: workspaces, forms,
submissions, users, groups, and roles, in Postgres and in the form engine.

Every run records the ids it creates in `soba.dev_data_run` as it creates them, and purge deletes
by those ids. Generated rows also carry a `[dev] ` name prefix and generated identities a
`dev-data:` subject, but those are for reading the UI: nothing keys off them, so renaming a
generated row is safe.

Deleting a run row by hand puts what it made out of purge's reach.

## Before you start

Bring the sidecars up and initialise the database:

```bash
pnpm dev:services:up && pnpm db:init
```

Everything except `--purge` checks this and stops with one instruction if it has not been done.

### Turning it on

Everything here is gated on the `dev-data` feature, which the migration inserts as **disabled**.
Each environment decides with `FEATURE_DEV_DATA_STATUS`, applied to `soba.feature` by `db:seed`:

| Value                     | Effect                                    |
| ------------------------- | ----------------------------------------- |
| unset or empty            | leave the feature as the migration set it |
| any `feature_status` code | set the feature to that status            |

Statuses are `enabled`, `disabled`, `experimental`, and `deprecated`; a value outside the
`feature_status` table stops the seed rather than leaving the environment quietly wrong. The same
`FEATURE_<CODE>_STATUS` pattern works for every backend feature, not just this one.

**Only `db:seed` reads the variable.** `db:dev-data` checks the stored status, so:

- changing the variable does nothing until you run `pnpm db:seed` again
- once the row is set it stays set, whether or not the variable is still there
- a fresh `pnpm db:init` puts the row back to the migration's `disabled`, so the variable has to be
  in your environment at that point, not at the point you run the generator

`backend/.env.example` sets `enabled` for local. Deployments set it per environment through
`backend.features` in the Helm values, read by the migration job that runs the seed. Production
leaves it off.

## Commands

```bash
pnpm db:dev-data --seed --username <idir-username>              # build the set
pnpm db:dev-data --purge                                        # remove it
pnpm db:dev-data --reset --username <idir-username>             # purge, then build
pnpm db:dev-data --help
pnpm db:dev-data:verify                                         # check the access coverage set
pnpm db:dev-data:verify --persona outsider --form protectedOwn  # explain one case
```

`--owner-file` must point inside the project; a path that escapes it is refused.
`--skip-anonymous` attributes the public user's submissions to the target user instead, so the
row counts the paging anchors depend on stay the same. `--purge --dry-run` reports what would be
removed without touching anything. Seed, purge and reset all echo the target database first.

### Size

`--size small | medium | large` (default `large`) scales workspaces, forms, submissions, and users
together. Each size is one more than a page size the tables offer, so the largest lists spill onto a
second page at that setting.

| Size     | Anchored rows | Workspaces | Forms | Submissions | Time |
| -------- | ------------- | ---------- | ----- | ----------- | ---- |
| `small`  | 6             | 7          | 15    | 16          | 3s   |
| `medium` | 11            | 12         | 29    | 44          | 6s   |
| `large`  | 21            | 24         | 74    | 202         | 16s  |

The role split, forms per workspace, submissions per form, and members per workspace are all derived
from that number, so every state listed below exists at every size. The counts leave out the
access coverage set, which is the same at every size.

## Choosing the owner

The data is built around one real user, named with `--username` and matched against
`app_user.display_label`, which holds the IdP username.

That user is never invented. Without the owner file below they must already exist, so a fresh
database needs a sign-in first:

```bash
pnpm db:dev-data --generate-owner-file --username <idir-username>   # once, after signing in
pnpm db:dev-data --seed                                             # from then on, anywhere
```

`--generate-owner-file` copies your real `app_user` and `user_identity` into `.devdata-owner`, which
is gitignored. With that file present, `--seed` takes no arguments: it creates the recorded user on
a database that has never seen them, then builds the set around them.

The recorded subject must stay real. Sign-in matches on `(provider, subject)`, so a real subject is
adopted on first login; an invented one leaves you signed in as a second, empty user with the data
on a ghost.

Precedence: no `--username` uses the file; a `--username` that matches the file uses the file;
otherwise the named user is looked up and must already exist.

The file does not carry `soba_admin`. A recreated user is not a platform admin until their next
sign-in restores it from their IdP claims.

## What gets built

Anchor workspaces are named so they sort early under the workspace list default, `name:asc`. The
lists page on the server, so a row past the first page is reachable; the naming keeps the anchors
in front of the generated bulk rather than hiding them behind it.

Three anchor workspaces hold the anchored row count for the chosen size:

| Anchor                     | Holds                                             |
| -------------------------- | ------------------------------------------------- |
| `[dev] Paging Forms`       | the anchored count in forms                       |
| `[dev] Paging Members`     | the anchored count in dev members, plus the owner |
| `[dev] Paging Submissions` | `[dev] Paging Submissions Form`, anchored count   |

Everything else is smaller than the anchors and spread so each distinct state exists somewhere:

- the owner holds all four workspace roles (at `large`: 12 owner, 3 admin, 3 member, 3 viewer), and
  some workspaces exist that they are not a member of. Every role has workspaces holding forms
- where they are not the owner they also get a group carrying form permissions for that role:
  admin `form_admin`, member `form_designer` + `form_submitter`, viewer `submission_approver`.
  Form access comes only from group roles, so without it a workspace role grants nothing
- some workspaces have no accepted disclaimer and so hold no forms, which the service blocks
- forms cover published and draft
- submissions cover `opened`, `draft`, and `submitted`, attributed to the owner, to dev users, and
  anonymously to the public user
- workspace audiences cover `protected` (a new workspace's default), `public`, and `members`

Generated users sit on active login providers (`azureidir`, `bceidbusiness`) with fabricated
subjects, so they cannot sign in. They exist to fill member lists, groups, and role assignments.

## Access coverage set

Every seed also builds a fixed set of named cases for submit, design and workspace access, the same
whatever `--size` or `--skip-anonymous` says. Its names start `[dev] Zz `, so it sorts after the
anchors and the bulk in English and French, and it is created first, so it trails `id:desc` lists
too.

Personas are the owner, the public user as an anonymous caller, and thirteen generated users:
`admin`, who owns the three workspaces, plus `submitter`, `designer`, `reviewer`, `viewer` (a
`viewer` member in an approvers group), `overrideRemoved`, `overrideAdded`, `inactiveMember`,
`inactiveGroupMember`, `inactiveGroup` (in an inactive group carrying form admin), `outsider`,
`bceidOutsider` (`bceidbusiness`), and `collaborator`.

| Workspace                    | Audience, drafts           | Review (status updates, submitter revision) | Forms                                                                                                                                                 |
| ---------------------------- | -------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[dev] Zz Coverage Roles`    | members only, on           | on, on                                      | inherits; override; cleared override; designers override; never published; form deleted; version deleted; version replaced; own drafts and review off |
| `[dev] Zz Coverage Audience` | protected `azureidir`, off | off, off                                    | inherits; own public; own protected `bceidbusiness`; own members only with review on                                                                  |
| `[dev] Zz Coverage Public`   | public, on                 | on, off                                     | inherits; own protected `azureidir`                                                                                                                   |

Twelve submissions cover owner and collaborator grants, an inactive grant, the opened, draft,
submitted and revising states, a deleted submission, anonymous submissions, submissions on a deleted
form and a deleted version, and a draft on a version a newer one replaced. Three submitted ones carry
staff notes; in Audience the admin assigns one to themselves, and in Roles another is assigned to the
reviewer, who completes it, and the reviewer sends a third back to the submitter to revise. The public user also holds a seat in Roles' form submitters group, which
grants it nothing.

For browser checks the owner is in the form submitters group in Roles and the form admins group in
Audience, and has a draft in Public without a membership.

[`access/expectations.ts`](./access/expectations.ts) records who each check admits, case by case.
`pnpm db:dev-data:verify` runs every persona against every case through the list queries and access
rules the submit and design routes and the workspace members and groups reads use, and exits 1 on
any difference:

- forms: listed in My Forms, start, draft, and the access check for `document_template_read` and
  `submission_update`
- design: listed in the designer, and the form's own check for `form_read`, `design_update`,
  `submission_read`, and `form_read` with `document_template_read` for the staff templates
- workspaces: reading the workspace's members and groups, and offered by the Create Form picker
- submissions: listed in My Submissions, and the read, write, file upload, file delete, render
  and delete rules

It also checks that the designer's forms, form versions and submissions lists each hold exactly the
forms whose own check allows them and leave out the deleted ones, that each form version and
submission resolves by id only while it, its form and its version are not deleted, that the Create
Form picker offers exactly the workspaces where the create check passes, and that the sign-in read
returns each persona's identity, user and admin row, compares IdP attributes as jsonb, and finds
nothing for an unknown subject or provider. The submit, file and document routes decide from one
read of each submission (`findSubmitterSubmission`); it must hold the role, form facts and
submission detail the separate participant, form and detail reads give, and find the same
submissions live. Start from the form read the open route and the form route share
(`findLiveSubmitterForm`) must match the open rules, and the version schema read
(`findSubmitterFormVersion`) must admit exactly those callers, to the published version only. Each
My Submissions row is read with its form's facts; that form must equal the My Forms row, and
Continue over it must match the write rule on a submission still in progress.

Write is the rule save and submit share; the request itself can still refuse the write or keep it
as pending. The command only reads, and needs no running backend. Change the table with any access
rule change. The owner's cells assume they sign in through `azureidir`; any other provider skips
them.

## Layout

| File                                     | Role                                                       |
| ---------------------------------------- | ---------------------------------------------------------- |
| [`plan.ts`](./plan.ts)                   | What gets created, as data. No DB, no engine, no clock     |
| [`generate.ts`](./generate.ts)           | Runs the plan through the services, returns a manifest     |
| [`purge.ts`](./purge.ts)                 | Removes it all, engine documents and stored bytes included |
| [`fixtures/`](./fixtures)                | Form definitions and answers matching their components     |
| [`members.ts`](./members.ts)             | Writes workspace memberships directly                      |
| [`access/`](./access)                    | The access coverage set, its expectations, and its checks  |
| [`ownerFile.ts`](./ownerFile.ts)         | Reads and writes `.devdata-owner`, creates the owner       |
| [`resolveUser.ts`](./resolveUser.ts)     | Looks the owner up by username                             |
| [`preconditions.ts`](./preconditions.ts) | Checks the database is migrated and seeded                 |
| [`guard.ts`](./guard.ts)                 | Refuses to run unless the dev-data feature is on           |
| [`runs.ts`](./runs.ts)                   | Records each run's ids in `soba.dev_data_run` as it goes   |
| [`cli.ts`](./cli.ts)                     | Argument parsing, output, exit codes                       |
| [`cliSupport.ts`](./cliSupport.ts)       | Usage errors, exit codes and pool shutdown for both CLIs   |

`generate()` and `purge()` take options and return results, with no argv, console, or process exit,
so an admin API route can drive them unchanged.

## Notes for anyone changing this

- Answers must match component keys. Form.io drops submission `data` keys that are not components,
  so a mismatched fixture yields empty submissions rather than an error. The fixture tests pin this.
- Values come from a row index, not from randomness, so a failing test reproduces tomorrow.
- Forms, versions, and submissions go through their services, because they are two-sided: a
  Postgres row without its engine document is broken. Workspaces, groups, settings, overrides,
  users, and the coverage set's collaborator grants and inactive statuses are direct repo calls or
  writes, bypassing checks the API applies (workspace creation would reject the BCeID
  dev users). The generated set is therefore not guaranteed to be reproducible through the API.
- Purge order: read engine refs and stored files, purge Postgres in one transaction, then delete
  engine documents and stored bytes best-effort. The reverse leaves live rows pointing at documents
  and bytes that are gone. Run purge where the backend runs (in its pod when deployed), so it uses
  the same storage profiles.
- Every save and submit creates a new engine document, so purge collects refs from
  `submission_revision` as well as from the submission row.
- A new table carrying `workspace_id` must be added to `WORKSPACE_SCOPED_TABLES` and to
  `purgeWorkspaceScoped`, or purge aborts on its foreign key. A test compares that list against the
  schema, so a missing name fails; it cannot tell whether the delete itself was written.
- Tables with a foreign key to `app_user` have the same requirement against
  `APP_USER_SCOPED_TABLES`, checked by the same test.
