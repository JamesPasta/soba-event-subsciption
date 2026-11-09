import { index, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { auditColumns, idColumn } from './audit';
import {
  idpGroups,
  identityProviders,
  sobaSchema,
  workspaceGroups,
  workspaceMemberships,
  workspaces,
} from './core';
import { forms } from './forms';

/**
 * A form's explicit override of a workspace group. An active row replaces the group's membership for
 * that form with the rows in form_group_override_member; roles stay on the workspace group. No active
 * row means the form inherits the workspace group's members.
 */
export const formGroupOverrides = sobaSchema.table(
  'form_group_override',
  {
    id: idColumn(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    formId: uuid('form_id')
      .notNull()
      .references(() => forms.id),
    groupId: uuid('group_id')
      .notNull()
      .references(() => workspaceGroups.id),
    status: text('status').notNull(),
    ...auditColumns(),
  },
  (table) => ({
    formGroupUnique: uniqueIndex('form_group_override_form_group_uq')
      .on(table.formId, table.groupId)
      .where(sql`${table.status} = 'active'`),
    workspaceIdx: index('form_group_override_workspace_idx').on(table.workspaceId),
    activeWorkspaceIdx: index('form_group_override_active_workspace_idx')
      .on(table.workspaceId, table.formId)
      .where(sql`${table.status} = 'active'`),
    formIdx: index('form_group_override_form_idx').on(table.formId),
    groupIdx: index('form_group_override_group_idx').on(table.groupId),
  }),
);

/**
 * An override's members. `member_kind` selects the ref, as in workspace_group_membership: 'user' ->
 * workspace_membership_id, 'idp' -> identity_provider_code, 'idp_group' -> idp_group_code.
 */
export const formGroupOverrideMembers = sobaSchema.table(
  'form_group_override_member',
  {
    id: idColumn(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    overrideId: uuid('override_id')
      .notNull()
      .references(() => formGroupOverrides.id),
    memberKind: text('member_kind').notNull(),
    workspaceMembershipId: uuid('workspace_membership_id').references(
      () => workspaceMemberships.id,
    ),
    identityProviderCode: text('identity_provider_code').references(() => identityProviders.code),
    idpGroupCode: text('idp_group_code').references(() => idpGroups.code),
    status: text('status').notNull(),
    ...auditColumns(),
  },
  (table) => ({
    userMemberUnique: uniqueIndex('form_group_override_member_user_uq')
      .on(table.overrideId, table.workspaceMembershipId)
      .where(sql`${table.memberKind} = 'user'`),
    idpMemberUnique: uniqueIndex('form_group_override_member_idp_uq')
      .on(table.overrideId, table.identityProviderCode)
      .where(sql`${table.memberKind} = 'idp'`),
    idpGroupMemberUnique: uniqueIndex('form_group_override_member_idp_group_uq')
      .on(table.overrideId, table.idpGroupCode)
      .where(sql`${table.memberKind} = 'idp_group'`),
    workspaceIdx: index('form_group_override_member_workspace_idx').on(table.workspaceId),
    overrideIdx: index('form_group_override_member_override_idx').on(table.overrideId),
    membershipIdx: index('form_group_override_member_membership_idx').on(
      table.workspaceMembershipId,
    ),
  }),
);
