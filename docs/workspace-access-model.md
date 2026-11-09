# Workspace access model

How access works for **internal workspaces** — the ones created inside SOBA (`kind = 'team'`, via
`POST /workspaces`). Enterprise/CSTAR tenant workspaces are provisioned differently; see
[CSTAR tenants](#cstar-tenants) at the end.

Two separate things control access:

- **Workspace management** — can you administer the workspace itself (rename it, manage members and
  groups)? This is a single coarse role on your membership.
- **Form access (RBAC)** — what can you do with the forms in the workspace? This comes from group
  membership → roles → permissions.

They don't overlap: being a workspace admin grants no form permissions, and vice versa. Submit mode
adds a third control per submission, who takes part in it; see
[Submission participants](#submission-participants).

> **Current status.** The design form routes (`api/forms/route.ts`), the staff submission routes
> (`api/submissions/route.ts`), staff print (`features/document-generation/designRoute.ts`) and
> staff file download (`features/files/designRoute.ts`) are gated by `requireFormPermissions`,
> except schema normalize (no workspace), and check the caller's permissions on the form in
> question (see
> [Resolving a user's permissions](#resolving-a-users-permissions)). Creating a form requires
> `form_create` and `design_create`; only `form_admin` satisfies that, via `*`. Creating a design on
> an existing form requires `design_create` and `design_update` (`form_designer`), since the create
> writes the design's schema. The submit routes decide with the submitter rules in `@soba/lib`; the
> file and submit document generation routes make the same read and decide by the same rules (see
> [Submission participants](#submission-participants)); rendering a document also needs
> `document_template_read`. The template routes (`features/templates/route.ts`) are gated by
> `requireFormPermissions`: `form_read` and `document_template_read` to list and download,
> `document_template_create` to upload, replace and rename, `document_template_delete` to delete. Of
> the seeded roles only `form_admin` (via `*`) holds any of these sets. A draft created from an
> existing version gets that version's templates under the draft's own permissions, without
> `document_template_create`. Reading and managing groups and members is gated by workspace role
> (`requireWorkspacePeopleRead`, `requireWorkspaceManage` in `middleware/requireWorkspaceRole.ts`),
> not by RBAC.

```
                        User in a workspace
                                 |
       workspace_membership.role |  group membership
            +--------------------+--------------------+
            |                                         |
            v                                         v
   +--------------------+                 +----------------------------+
   | Workspace mgmt     |    no overlap   | Form access (RBAC)         |
   | rename, members,   | <----- X -----> | read/edit/publish forms,   |
   | groups             |                 | submissions                |
   +--------------------+                 +----------------------------+
```

## Workspace management

`workspace_membership` is the roster: one row per (user, workspace) with a coarse `role` of `owner`,
`admin`, `member`, or `viewer`. `owner`/`admin` may administer the workspace, checked with
`isWorkspaceManageRole(role)` straight off the membership row (e.g. `updateWorkspaceName` in
`workspaceRepo.ts`, mirrored on the frontend in `workspaceRoles.ts`). `owner`, `admin` and `member`
may read the workspace's groups and members (`isWorkspacePeopleReadRole`); a `viewer` may not, but
lists the workspace and reads its settings.

Workspace resolution reads the role from the membership on every request (`findActorMembership` in
`membershipRepo.ts`); nothing caches it, so a role change applies to the caller's next request.
Submit-surface contexts carry `role: null` for a caller with no membership, and for every caller of
open, save, submit and file upload; neither workspace role guard accepts it.

That role is the only source of workspace-management authority. It's never read for form permissions.

### Managing groups and members

Groups, their roles, and their members are managed through the group APIs. Writes are gated by
`requireWorkspaceManage` (owner/admin, via `req.coreContext.role`) and the list by
`requireWorkspacePeopleRead` (owner, admin, member):

| method   | path                                                | effect                                                 |
| -------- | --------------------------------------------------- | ------------------------------------------------------ |
| `GET`    | `/workspaces/:id/groups`                            | list active groups with their roles and `user` members |
| `POST`   | `/workspaces/:id/groups`                            | create a group carrying `roleCodes`                    |
| `PATCH`  | `/workspaces/:id/groups/:groupId`                   | rename / re-describe a group                           |
| `DELETE` | `/workspaces/:id/groups/:groupId`                   | soft-delete a group                                    |
| `PUT`    | `/workspaces/:id/groups/:groupId/roles`             | replace a group's role set                             |
| `POST`   | `/workspaces/:id/groups/:groupId/members`           | add a workspace member (by `membershipId`)             |
| `DELETE` | `/workspaces/:id/groups/:groupId/members/:memberId` | remove a member by its row id                          |

Group names are unique among **active** groups in a workspace. Delete is a soft-delete: the group and
its roles and memberships are set to `inactive` in one transaction, so the resolver (which only reads
active roles/memberships) stops granting through it, and the name frees up for reuse.

`GET /members?workspaceId=` lists the workspace's members under the same read rule.

Only `user` members are managed here. Per-form overrides are covered in
[Form-level overrides](#form-level-overrides). The repo (`workspaceGroupRepo.ts`) is shared with
workspace bootstrap.

**Protected groups.** The two bootstrap groups carry a hidden `workspace_group.system_code`
(`form_admins`/`form_submitters`) so protections don't depend on the renameable name. Both can be
renamed but not deleted, and their roles can't be changed; _Form administrators_ must always keep at
least one active user member (the last member can't be removed). Attempts return 409. The group DTO
exposes a `system` boolean so the UI can hide those actions.

**Members are people.** Each member is `{id, kind:'user', membershipId, userId, displayLabel}`, added
via `POST /workspaces/:id/groups/:groupId/members` with `{kind:'user', membershipId}` and removed by
row id. Who outside the workspace may submit is not group membership; it is the
[Form Audience](#form-audience) setting.

## Form access (RBAC)

Form permissions come from **groups**. A workspace has groups, each group carries one or more roles, and
each role grants permissions. Users are members of groups.

```
   workspace
      |
      +-- has --> workspace_group
                     |
                     +-- carries --> workspace_group_role --> role
                     |                                          |
                     |                          grants (role_permission)
                     |                                          v
                     |                                       permission
                     |
                     +-- contains --> workspace_group_membership
                                          |
                                          +  member_kind = user      --> workspace_membership
```

- `workspace_group` — a named group in a workspace.
- `workspace_group_role` — the role(s) a group carries (many-to-many; a group can hold more than one).
- `workspace_group_membership` — who is in a group.
- `role` / `permission` / `role_permission` — the catalog: the roles, the permissions, and the mapping
  between them.

### The catalog

Six form roles are seeded (`role` + `role_permission`):

| role                  | permissions                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `form_admin`          | `*` (everything)                                                                                                                      |
| `form_designer`       | `form_read`, `design_create`, `design_read`, `design_update`, `design_delete`                                                         |
| `form_submitter`      | `submission_create`, `document_template_read`                                                                                         |
| `submission_reviewer` | `form_read`, `submission_read`, `submission_update`, `submission_delete`, `submission_review`, `submission_print_upload`, `team_read` |
| `submission_approver` | `form_read`, `submission_read`, `submission_review`, `submission_print_upload`, `team_read`                                           |
| `team_manager`        | `form_read`, `team_read`, `team_update`                                                                                               |

`*` is a wildcard: a role holding it satisfies any permission check. Only `form_admin` has it, so adding
new permissions later needs no change to that role.

`form_submitter` holds no `form_read`, so someone who can only submit has no design access.

`form_create` is catalogued but not assigned to any seeded role. Only `form_admin` can create a form
(via `*`). `form_designer` can create a new design on an existing form (`design_create` and
`design_update`).

`submission_print_upload`, with `submission_read`, lets staff print a submission with a template
uploaded for that print only.

The permission codes are: `form_create/read/update/delete`, `design_create/read/update/delete`,
`submission_create/read/update/delete/review/print_upload`, `team_read/update`, `document_template_create/read/delete`.

### Group membership is "who", not "what"

A `workspace_group_membership` row records _which_ people are in a group, never their role. The role
lives on the group (`workspace_group_role`). A member is `member_kind = user`, referencing a
`workspace_membership_id`. The table also allows `idp` and `idp_group` kinds, which nothing writes or
reads.

`user` members are resolved for form permissions by `resolveFormPermissions` (one form) and
`resolveWorkspacePermissions` (the workspace) in `formAccessRepo.ts`.

### The special groups

Creating a workspace bootstraps two form groups (`bootstrapWorkspaceOwner` in `workspaceRepo.ts`):

| group               | role             | members on create     |
| ------------------- | ---------------- | --------------------- |
| Form administrators | `form_admin`     | the workspace creator |
| Form submitters     | `form_submitter` | none                  |

So the creator can do everything with the workspace's forms. Form submitters holds the people given
the submit role.

### Form-level overrides

A form can override a workspace group's membership for itself. A new form overrides nothing and
inherits every group, so a change to a workspace group reaches every form that has not overridden it.

- `form_group_override` - one active row per (form, group) marks an explicit override.
- `form_group_override_member` - the override's members, with the same `member_kind` references and
  constraints as `workspace_group_membership`.

An override replaces the group's whole membership for that form; roles stay on the workspace group.
Returning to inherit sets the override `inactive` and deletes its members.
`effectiveGroups` in `formAccessRepo.ts` resolves, per form, the groups a user is an effective
member of: each active group's override members where the form has an active override, otherwise the
workspace group's members.

No API writes overrides yet.

The submit surface reads overrides: `hasFormSubmitAccess({workspaceId, formId}, ...)` reads the
form's facts with `findSubmitterFormFacts` in `submitterFormRepo.ts`, whose permissions follow the
caller's effective `user` memberships by the same rule, and decides with `formAccessAllows` from
`@soba/lib`, which also checks the form's [audience](#form-audience). Submit mode uses it to open a
submission, alongside participation to save, submit, upload and delete a file on an in-progress
submission, and on its own (`submission_update`) to delete a file on a submitted submission. Design
routes and lists read overrides by the same rule; see
[Resolving a user's permissions](#resolving-a-users-permissions).

### Form Audience

Who outside the workspace may submit is a shared settings group (see [Form settings](form-settings.md)):

- `workspace_audience_setting` - one row per workspace, created with it: `mode` and `idps`.
- `form_audience_setting` - one row per form, created with it: `inherit`, and the form's own `mode`
  and `idps` while it does not inherit.

| mode        | admits                                                                    |
| ----------- | ------------------------------------------------------------------------- |
| `public`    | everyone, including anonymous callers                                     |
| `protected` | callers signed in through one of `idps`, which are active login providers |
| `members`   | no one beyond role holders                                                |

An audience conveys only `submission_create` and `document_template_read` (`isAudiencePermission` in
`@soba/lib`); every other permission needs a role.

A form that inherits uses its workspace's audience, read when asked, so a workspace change reaches it
with nothing copied. A form may be more open than its workspace. Anyone a group gives
`submission_create` can submit whatever the audience. A new workspace is `protected` by
`DEFAULT_SUBMITTER_PROVIDER` (`azureidir` when unset) when that is an active login provider, otherwise
`members`. Anonymous callers carry the `public` pseudo provider (`is_login_provider = false`), which
no audience lists.

| method        | path                                                 | effect                                                                                                                                                       |
| ------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET` / `PUT` | `/workspaces/:id/settings/audience`                  | reads and saves `{values: {mode, idps}, version}`; any member reads, owner/admin writes                                                                      |
| `GET`         | `/workspaces/:id/settings/audience/inheriting-forms` | `{count}` of live forms that use the workspace's audience; any member                                                                                        |
| `GET` / `PUT` | `/design/forms/:id/settings/audience`                | reads `{inherit, own, workspace, effective, version}`; saves `{inherit: true, version}` or `{inherit: false, values, version}` (`form_read` / `form_update`) |

A save names the `version` it read; a save from an older one gets a 409 and changes nothing. A new
form can start with its own audience from `settings.audience` in the create body.

The submit-side facts query (`findSubmitterFormFacts` in `submitterFormRepo.ts`) reads the form's
effective audience and drafts setting the same way.
Drafts are not offered on a public audience.

### Resolving a user's permissions

`formAccessRepo.ts` has two resolvers. Each returns the permission codes a user holds through the
active roles of the active groups they are an active `user` member of; a set containing `*` grants
everything.

- `resolveFormPermissions(actorId, workspaceId, formId)` - on one form, with its overrides applied
  (`permissionsByForm` over `effectiveGroups`).
- `resolveWorkspacePermissions(actorId, workspaceId)` - across the workspace, without overrides.

```
   actorId + workspaceId (+ formId)
        |
        v
   workspace_group_membership     (member_kind = user, active; on a form, a group the form
        |                          overrides takes its form_group_override_member rows instead)
        v
   workspace_group_role
        |
        v
   role_permission
        |
        v
   permission set                 (may contain '*')
```

`requireFormPermissions(required)` checks the form in `req.coreContext.formId` when there is one and
the workspace otherwise (creating a form), and answers 403 when a code is missing.
`workspaceFromResource` sets `formId` for a form or anything under one (version, submission,
template), and `workspaceListScope` sets it for a list anchored by a form, version or submission.
`hasAllPermissions(perms, required)` from `@soba/lib` does the check and treats `*` as a match for
anything.

A design list that names no form is filtered, not refused. Anchored by a workspace, it needs
membership (403 otherwise); with no anchor, it covers every workspace the caller is an active member
of. `resolveFormAccessGrant` first reads the workspaces whose permissions hold the codes, the forms
there with an active override, and which of those hold the codes on their own. The list repos then
keep only the rows that grant allows (`permittedFormsWhere`): a form without an active override is
allowed by its workspace, and an overridden form only by its own permissions. Page and total share
the grant, and a list repo called without one returns nothing. A list anchored by a form, version or
submission is checked on that form and gets a grant for that form alone.

A record counts as deleted when it, its form or its form version is deleted (`liveRows.ts`). Lists
leave deleted records out, and looking one up by id returns 404, in design and submit mode alike,
before any permission check.

`GET /design/forms/:id` returns the caller's codes on that form as `permissions` (a sorted array,
`['*']` for admins) so the UI can gate actions.

## Submission participants

Once a submission exists, reading it in submit mode needs an active grant on it, and changing it
needs a form permission. `submission_participant` holds one row per grant: `user_id`, `role` (`owner`
or `collaborator`), `status` (`active` or `inactive`), `granted_by`, and `revoked_by`/`revoked_at`. A
grant is revoked, never deleted, so the rows are the access history. Opening a submission makes the
opener its owner. The shared public user owns anonymous submissions, so any anonymous caller holding
the id has access to those.

The rules are pure functions in `@soba/lib` (`permissions/submitterSubmission.ts`), and the browser
runs the same functions. A submit route on one submission reads it once with
`findSubmitterSubmission` (the submission, the caller's active grant and its form's facts), then
one guard decides; open reads its form once with `findLiveSubmitterForm`. File uploads, file
reads and deletes, and document generation make the same read and decide by the same rules;
`services/submitterAccess.ts` maps each operation to its rule:

| operation                                               | needs                                                                                     |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `open`                                                  | `submission_create` on the form (`hasFormSubmitAccess`)                                   |
| `read`: confirmation, data, schema, fill, file download | an active grant                                                                           |
| `write`: save, submit                                   | an active grant and `submission_create` on the form                                       |
| `upload`: a file                                        | `write`, on an opened or draft submission                                                 |
| `deleteFile`                                            | `write` on an opened or draft submission; once submitted, `submission_update` on the form |
| `render`: print, template list                          | an active grant and `document_template_read` on the form                                  |
| `delete`: the caller's own submission                   | a signed-in caller with an active owner grant                                             |

Owners and collaborators have the same access, except that only an owner deletes. A submitter
deletes only an opened or draft submission; a submitted one is a 409. `@soba/lib` holds those states
and the rules the routes decide with; My Submissions applies them to each row and the form facts
read with it (`canContinueSubmission`, `canDeleteOwnSubmission`), so a row offers Continue only when
the caller can still write it and Delete only when they can delete it. The public user's ownership
grants no delete, because every anonymous caller shares it. Design routes do not use these rules;
staff read, delete and print submissions through form permissions. Staff download a submission's
files through `/design/submissions/:id/files/:fileId` with `submission_read`. Staff print through
`/design/submissions/:id/{templates,print}` with `submission_read`, and with a template uploaded for
that print through `/design/print-upload/:id` with `submission_print_upload` as well.

A repeated write gets its recorded answer before these rules run, so a retry keeps its answer after
the form's settings change. A save or submit whose revision id the caller already recorded on the
submission answers where it landed, given an active grant; the same id from another actor or event
is a 409. An open of an id the caller already owns, on the same form, answers that submission.

`GET /submit/submissions/mine` lists the draft and submitted submissions the caller holds an active
grant on, across every workspace, with the caller's role on each. Submissions on a deleted form or
form version are left out. Anonymous callers get a 401, since the public user's grants are shared.

`GET /submit/forms/mine` lists the forms the caller holds the `form_submitter` role on, plus the forms
of the submissions `GET /submit/submissions/mine` returns, across every workspace. The role resolves
like any form permission, so a form's active override of a group replaces that group's workspace
members. Only that role lists a form, not every role granting `submission_create`: form
administrators find their forms in design mode. A role form needs a published version; a form
reached through a submission is listed without one. Each row carries the facts the access rules
read: the caller's permission codes on the form, its effective audience, its effective drafts
setting and its published version. The rules are pure functions in `@soba/lib`
(`formAccessAllows`, `canStartSubmission`, `canSaveSubmissionDraft`, `draftSaveStatusOf`). The
browser works out Start from a row, and `hasFormSubmitAccess` and `getDraftSaveStatus` decide from
the same facts, read for one form by `findSubmitterFormFacts`. `GET /submit/workspaces/mine` lists
those forms' workspaces, for a filter. Both need a signed-in caller.

## What a new workspace looks like

Creating a workspace writes, in one transaction:

- 1 `workspace` (`kind = 'team'`)
- 1 `workspace_membership` for the creator (`role = 'owner'`)
- 2 `workspace_group` — "Form administrators", "Form submitters"
- 2 `workspace_group_role` — those groups' `form_admin` / `form_submitter` roles
- 1 `workspace_group_membership` - the creator in "Form administrators"
- 1 row per shared settings group, such as `workspace_audience_setting`

## CSTAR tenants

Everything above is internal workspaces. Enterprise/CSTAR tenant workspaces (`kind = 'enterprise'`) are
meant to be provisioned from the CSTAR Tenant Management System and synced in — groups and role assignments
come from there. They land in the same `workspace` / `workspace_group` / `workspace_membership` tables, so
don't assume a row was created locally.

The `enterprise-cstar` resolver plugin and `enterprise_binding` repo were removed in 2026-07 (dormant:
`resolve()` was never called, workspace context is resolved per-route by `workspaceContext` now). The
binding/sync tables are kept for a future sync and are currently empty: `enterprise_workspace_binding`,
`enterprise_group_binding`, `enterprise_membership_binding`, `enterprise_sync_cursor`, `enterprise_sync_log`.

Notes for whoever builds the sync (checked against the CSTAR codebase):

- Pull only — no webhooks or events. A poller on our side fetches and reconciles.
- No `updated_since` or cursor params. Watermark client-side on each entity's `updatedDateTime` +
  `isDeleted`, stashed in `enterprise_sync_cursor.cursor_value`.
- CSTAR is group-centric: roles go Role → Group → User (`GroupSharedServiceRole`). Bind CSTAR `Group.id` to
  `workspace_group_id`; our group→role catalog does the rest.
- Identity: `provider_identity_subject` = CSTAR `SSOUser.ssoUserId`, `provider_identity_type` = `idpType`
  (`idir` / `bceidbusiness` / `azureidir`; no Basic BCeID).
- Auth to CSTAR as a registered shared service (JWT audience = our `clientIdentifier`).
- Nothing maps CSTAR `SharedServiceRole` → our role yet. Check whether group binding covers it or add a table.
