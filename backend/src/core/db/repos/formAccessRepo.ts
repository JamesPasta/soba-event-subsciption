import {
  and,
  eq,
  exists,
  inArray,
  isNull,
  not,
  notExists,
  or,
  sql,
  type SQL,
  type SQLWrapper,
} from 'drizzle-orm';
import { unionAll, type AnyPgColumn, type PgSelect } from 'drizzle-orm/pg-core';
import { db } from '../client';
import {
  formGroupOverrideMembers,
  formGroupOverrides,
  forms,
  rolePermissions,
  workspaceGroupMemberships,
  workspaceGroupRoles,
  workspaceGroups,
  workspaceMemberships,
} from '../schema';
import {
  FormGroupOverrideStatus,
  GroupMemberKind,
  Permissions,
  WorkspaceGroupMembershipStatus,
  WorkspaceGroupRoleStatus,
  WorkspaceGroupStatus,
  WorkspaceMembershipStatus,
  type PermissionCode,
} from '../codes';

/** Narrows the groups a caller is an effective member of. */
interface GroupScope {
  workspaceId?: string;
  /** Only these forms: ids, or a subquery returning them. */
  formIds?: string[] | SQLWrapper;
  /** Only groups carrying this role, active. */
  roleCode?: string;
  /** Leave out deleted forms. */
  liveFormsOnly?: boolean;
}

/**
 * The forms a list may show, resolved for one actor and set of codes before the list runs. A form
 * without an active override is allowed by its workspace; an overridden form only by its own
 * permissions.
 */
export interface FormAccessGrant {
  /** Workspaces where the actor's workspace permissions hold every code. */
  workspaceIds: string[];
  /** Forms in scope with an active override. */
  overriddenFormIds: string[];
  /** Forms allowed by their own permissions, whatever their workspace grants. */
  includedFormIds: string[];
}

const activeMembershipOf = (userId: string) =>
  and(
    eq(workspaceMemberships.userId, userId),
    eq(workspaceMemberships.status, WorkspaceMembershipStatus.active),
  );

/** Joins workspace_membership to its active user-kind group memberships. */
const activeUserGroupMembership = and(
  eq(workspaceGroupMemberships.workspaceMembershipId, workspaceMemberships.id),
  eq(workspaceGroupMemberships.workspaceId, workspaceMemberships.workspaceId),
  eq(workspaceGroupMemberships.memberKind, GroupMemberKind.user),
  eq(workspaceGroupMemberships.status, WorkspaceGroupMembershipStatus.active),
);

/** Joins the active workspace group `groupId` names. */
const activeGroup = (groupId: SQLWrapper) =>
  and(eq(workspaceGroups.id, groupId), eq(workspaceGroups.status, WorkspaceGroupStatus.active));

/**
 * The groups the user is an effective member of, per form: a form's active override of a group
 * replaces that group's workspace members with its own. User members only. With no user, every
 * active member's groups, each row naming its member.
 */
export const effectiveGroups = (userId: string | null, scope: GroupScope) => {
  const activeMembership = and(
    userId
      ? activeMembershipOf(userId)
      : eq(workspaceMemberships.status, WorkspaceMembershipStatus.active),
    scope.workspaceId ? eq(workspaceMemberships.workspaceId, scope.workspaceId) : undefined,
  );
  const inScope = (formId: SQLWrapper) =>
    scope.formIds ? inArray(formId, scope.formIds) : undefined;
  // Checked on the group before its forms are joined, so other groups never reach the forms.
  const carriesRole = scope.roleCode
    ? exists(
        db
          .select({ id: workspaceGroupRoles.id })
          .from(workspaceGroupRoles)
          .where(
            and(
              eq(workspaceGroupRoles.groupId, workspaceGroups.id),
              eq(workspaceGroupRoles.status, WorkspaceGroupRoleStatus.active),
              eq(workspaceGroupRoles.roleCode, scope.roleCode),
            ),
          ),
      )
    : undefined;
  const live = scope.liveFormsOnly ? isNull(forms.deletedAt) : undefined;
  // Drizzle does not qualify a subquery's aliased columns, so the names must not match a table's.
  const formId = sql<string>`${forms.id}`.as('effective_form_id');
  const groupId = sql<string>`${workspaceGroups.id}`.as('effective_group_id');
  const memberId = sql<string>`${workspaceMemberships.userId}`.as('effective_user_id');

  const inherited = db
    .select({ formId, groupId, userId: memberId })
    .from(workspaceMemberships)
    .innerJoin(workspaceGroupMemberships, activeUserGroupMembership)
    .innerJoin(workspaceGroups, and(activeGroup(workspaceGroupMemberships.groupId), carriesRole))
    .innerJoin(
      forms,
      and(eq(forms.workspaceId, workspaceMemberships.workspaceId), inScope(forms.id), live),
    )
    .where(
      and(
        activeMembership,
        notExists(
          db
            .select({ id: formGroupOverrides.id })
            .from(formGroupOverrides)
            .where(
              and(
                eq(formGroupOverrides.formId, forms.id),
                eq(formGroupOverrides.groupId, workspaceGroups.id),
                eq(formGroupOverrides.status, FormGroupOverrideStatus.active),
              ),
            ),
        ),
      ),
    );

  const overridden = db
    .select({ formId, groupId, userId: memberId })
    .from(workspaceMemberships)
    .innerJoin(
      formGroupOverrideMembers,
      and(
        eq(formGroupOverrideMembers.workspaceMembershipId, workspaceMemberships.id),
        eq(formGroupOverrideMembers.memberKind, GroupMemberKind.user),
        eq(formGroupOverrideMembers.status, WorkspaceGroupMembershipStatus.active),
      ),
    )
    .innerJoin(
      formGroupOverrides,
      and(
        eq(formGroupOverrides.id, formGroupOverrideMembers.overrideId),
        eq(formGroupOverrides.workspaceId, workspaceMemberships.workspaceId),
        eq(formGroupOverrides.status, FormGroupOverrideStatus.active),
        inScope(formGroupOverrides.formId),
      ),
    )
    .innerJoin(workspaceGroups, and(activeGroup(formGroupOverrides.groupId), carriesRole))
    .innerJoin(
      forms,
      and(
        eq(forms.id, formGroupOverrides.formId),
        eq(forms.workspaceId, workspaceMemberships.workspaceId),
        live,
      ),
    )
    .where(activeMembership);

  return unionAll(inherited, overridden);
};

/** Joins the active roles of the group in `groupId`, and their permission codes. */
const withRolePermissions = <T extends PgSelect>(query: T, groupId: SQLWrapper) =>
  query
    .innerJoin(
      workspaceGroupRoles,
      and(
        eq(workspaceGroupRoles.groupId, groupId),
        eq(workspaceGroupRoles.status, WorkspaceGroupRoleStatus.active),
      ),
    )
    .innerJoin(rolePermissions, eq(rolePermissions.roleCode, workspaceGroupRoles.roleCode));

/** Per form, the user's permission codes from the active roles of their effective groups. */
export const permissionsByForm = (userId: string, scope: GroupScope) => {
  const groups = effectiveGroups(userId, scope).as('effective_group');
  return withRolePermissions(
    db
      .select({
        formId: groups.formId,
        permissions: sql<string[]>`array_agg(distinct ${rolePermissions.permissionCode})`.as(
          'access_permissions',
        ),
      })
      .from(groups)
      .$dynamic(),
    groups.groupId,
  ).groupBy(groups.formId);
};

/**
 * The users who hold `code`, or '*', on one live form, with the form's group overrides applied.
 */
export const listFormUserIdsHolding = async (
  workspaceId: string,
  formId: string,
  code: PermissionCode,
): Promise<string[]> => {
  const groups = effectiveGroups(null, {
    workspaceId,
    formIds: [formId],
    liveFormsOnly: true,
  }).as('effective_group');
  const rows = await withRolePermissions(
    db.selectDistinct({ userId: groups.userId }).from(groups).$dynamic(),
    groups.groupId,
  ).where(inArray(rolePermissions.permissionCode, [code, Permissions.all]));
  return rows.map((row) => row.userId);
};

/**
 * Joins, onto workspace_membership, the member's active groups and the permission codes of those
 * groups' active roles. User members only; form overrides are not applied.
 */
const withGroupPermissions = <T extends PgSelect>(query: T) =>
  withRolePermissions(
    query
      .innerJoin(workspaceGroupMemberships, activeUserGroupMembership)
      .innerJoin(workspaceGroups, activeGroup(workspaceGroupMemberships.groupId)),
    workspaceGroups.id,
  );

/** For a grouped role_permission set: the '*' wildcard, or every code in `required`. */
const holdsAll = (required: readonly string[]): SQL => {
  const codes = [...new Set(required)];
  return sql`bool_or(${eq(rolePermissions.permissionCode, Permissions.all)}) or count(distinct ${rolePermissions.permissionCode}) filter (where ${inArray(rolePermissions.permissionCode, codes)}) = ${codes.length}`;
};

/**
 * Whether the outer query's workspace_membership row holds `code`, or '*', through an active group's
 * active role. Correlated to that row, not to any member of its workspace.
 */
export const membershipHoldsPermission = (code: string): SQL =>
  exists(
    withRolePermissions(
      db
        .select({ permissionCode: rolePermissions.permissionCode })
        .from(workspaceGroupMemberships)
        .innerJoin(workspaceGroups, activeGroup(workspaceGroupMemberships.groupId))
        .$dynamic(),
      workspaceGroups.id,
    ).where(
      and(
        activeUserGroupMembership,
        inArray(rolePermissions.permissionCode, [code, Permissions.all]),
      ),
    ),
  );

/**
 * Permission codes the user holds across a workspace, from the roles of the workspace groups they
 * belong to, without any form's overrides. A returned set containing '*' grants everything.
 */
export const resolveWorkspacePermissions = async (
  actorId: string,
  workspaceId: string,
): Promise<Set<string>> => {
  const rows = await withGroupPermissions(
    db
      .selectDistinct({ permissionCode: rolePermissions.permissionCode })
      .from(workspaceMemberships)
      .$dynamic(),
  ).where(and(activeMembershipOf(actorId), eq(workspaceMemberships.workspaceId, workspaceId)));

  return new Set(rows.map((row) => row.permissionCode));
};

/**
 * Permission codes the user holds on one form, with the form's group overrides applied. A returned
 * set containing '*' grants everything.
 */
export const resolveFormPermissions = async (
  actorId: string,
  workspaceId: string,
  formId: string,
): Promise<Set<string>> => {
  const rows = await permissionsByForm(actorId, { workspaceId, formIds: [formId] });
  return new Set(rows[0]?.permissions ?? []);
};

/** A grant for one form whose permissions were already checked. */
export const formAccessGrantFor = (formId: string): FormAccessGrant => ({
  workspaceIds: [],
  overriddenFormIds: [],
  includedFormIds: [formId],
});

/**
 * True when a list is empty without querying: no workspace, no grant, or a grant that allows no
 * form.
 */
export const listAllowsNothing = (
  workspaceIds: string[],
  grant: FormAccessGrant | undefined,
): boolean =>
  workspaceIds.length === 0 ||
  !grant ||
  (grant.workspaceIds.length === 0 && grant.includedFormIds.length === 0);

/** `column` is one of `ids`, bound as one array parameter however long the list. */
const isOneOf = (column: AnyPgColumn, ids: string[]): SQL =>
  ids.length ? sql`${column} = any(${sql.param(ids)}::uuid[])` : sql`false`;

/** Of the forms `formIds` returns, those whose own permissions hold every required code. */
const formsHoldingAll = async (
  actorId: string,
  required: readonly PermissionCode[],
  formIds: SQLWrapper,
): Promise<string[]> => {
  const groups = effectiveGroups(actorId, { formIds }).as('effective_group');
  const rows = await withRolePermissions(
    db.select({ formId: groups.formId }).from(groups).$dynamic(),
    groups.groupId,
  )
    .groupBy(groups.formId)
    .having(holdsAll(required));
  return rows.map((row) => row.formId);
};

/**
 * Which forms in `workspaceIds` grant the actor every required code: the workspaces whose
 * permissions hold them, the forms there with an active override, and which of those hold them on
 * their own.
 */
export const resolveFormAccessGrant = async (
  actorId: string,
  required: readonly PermissionCode[],
  workspaceIds: string[],
): Promise<FormAccessGrant> => {
  if (workspaceIds.length === 0) {
    return { workspaceIds: [], overriddenFormIds: [], includedFormIds: [] };
  }
  const granting = withGroupPermissions(
    db
      .select({ workspaceId: workspaceMemberships.workspaceId })
      .from(workspaceMemberships)
      .$dynamic(),
  )
    .where(
      and(activeMembershipOf(actorId), isOneOf(workspaceMemberships.workspaceId, workspaceIds)),
    )
    .groupBy(workspaceMemberships.workspaceId)
    .having(holdsAll(required));
  const overriddenForms = db
    .selectDistinct({ formId: formGroupOverrides.formId })
    .from(formGroupOverrides)
    .where(
      and(
        isOneOf(formGroupOverrides.workspaceId, workspaceIds),
        eq(formGroupOverrides.status, FormGroupOverrideStatus.active),
      ),
    );
  const [grantingRows, overriddenRows] = await Promise.all([granting, overriddenForms]);
  const overriddenFormIds = overriddenRows.map((row) => row.formId);
  return {
    workspaceIds: grantingRows.map((row) => row.workspaceId),
    overriddenFormIds,
    // Reused as a subquery so the ids are not bound one parameter each.
    includedFormIds: overriddenFormIds.length
      ? await formsHoldingAll(actorId, required, overriddenForms)
      : [],
  };
};

/** A table's workspace and form columns. */
interface FormColumns {
  workspaceId: AnyPgColumn;
  formId: AnyPgColumn;
}

/** Keeps rows whose form the grant allows. */
export const permittedFormsWhere = (grant: FormAccessGrant, columns: FormColumns): SQL =>
  or(
    and(
      isOneOf(columns.workspaceId, grant.workspaceIds),
      not(isOneOf(columns.formId, grant.overriddenFormIds)),
    ),
    isOneOf(columns.formId, grant.includedFormIds),
  );
