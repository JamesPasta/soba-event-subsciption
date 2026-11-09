import { and, asc, count, eq, ilike, inArray, ne } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import {
  ApiErrorCodes,
  WORKSPACE_GROUP_SORT_FIELDS,
  type SortLocale,
  type SortToken,
} from '@soba/lib';
import { db, type DbOrTx, type Tx } from '../client';
import { collated, likePattern, orderByForSort, type SortColumns } from '../listSort';
import { readListPage } from '../listRead';
import {
  appUsers,
  workspaceGroupMemberships,
  workspaceGroupRoles,
  workspaceGroups,
  workspaceMemberships,
} from '../schema';
import {
  GroupMemberKind,
  SystemGroup,
  WorkspaceGroupMembershipStatus,
  WorkspaceGroupRoleStatus,
  WorkspaceGroupStatus,
  WorkspaceMembershipStatus,
} from '../codes';
import { ConflictError } from '../../errors';
import { LAST_FORM_ADMIN } from '../../messages';

/** Insert rows for a group's role set; duplicate codes collapse to one row. */
const groupRoleRows = (args: {
  workspaceId: string;
  groupId: string;
  roleCodes: string[];
  displayLabel: string | null;
}) =>
  [...new Set(args.roleCodes)].map((roleCode) => ({
    id: uuidv7(),
    workspaceId: args.workspaceId,
    groupId: args.groupId,
    roleCode,
    status: WorkspaceGroupRoleStatus.active,
    createdBy: args.displayLabel,
    updatedBy: args.displayLabel,
  }));

/** Creates a workspace group carrying the given roles; returns the new group id. */
export const createGroupWithRole = async (
  executor: DbOrTx,
  args: {
    workspaceId: string;
    name: string;
    roleCodes: string[];
    description?: string | null;
    systemCode?: string | null;
    displayLabel: string | null;
  },
): Promise<string> => {
  const groupId = uuidv7();
  await executor.insert(workspaceGroups).values({
    id: groupId,
    workspaceId: args.workspaceId,
    name: args.name,
    description: args.description ?? null,
    systemCode: args.systemCode ?? null,
    status: WorkspaceGroupStatus.active,
    createdBy: args.displayLabel,
    updatedBy: args.displayLabel,
  });
  if (args.roleCodes.length) {
    await executor.insert(workspaceGroupRoles).values(groupRoleRows({ ...args, groupId }));
  }
  return groupId;
};

/** Adds a workspace member (by membership id) to a group. */
export const addUserToGroup = async (
  executor: DbOrTx,
  args: { workspaceId: string; groupId: string; membershipId: string; displayLabel: string | null },
) => {
  await executor.insert(workspaceGroupMemberships).values({
    id: uuidv7(),
    workspaceId: args.workspaceId,
    workspaceMembershipId: args.membershipId,
    groupId: args.groupId,
    status: WorkspaceGroupMembershipStatus.active,
    createdBy: args.displayLabel,
    updatedBy: args.displayLabel,
  });
};

/** A group member: a workspace user. */
export interface WorkspaceGroupMember {
  id: string;
  kind: 'user';
  membershipId: string;
  userId: string;
  displayLabel: string | null;
}

export interface WorkspaceGroupRow {
  id: string;
  name: string;
  description: string | null;
  status: string;
  /** True for the two protected bootstrap groups (can't be deleted; roles can't change). */
  system: boolean;
  roles: string[];
  members: WorkspaceGroupMember[];
}

export type WorkspaceGroupListSortField = (typeof WORKSPACE_GROUP_SORT_FIELDS)[number];
export type WorkspaceGroupListSort = SortToken<WorkspaceGroupListSortField>;

const WORKSPACE_GROUP_SORT_COLUMNS: SortColumns<WorkspaceGroupListSortField> = {
  name: { column: workspaceGroups.name, linguistic: true },
};

const groupColumns = {
  id: workspaceGroups.id,
  name: workspaceGroups.name,
  description: workspaceGroups.description,
  status: workspaceGroups.status,
  systemCode: workspaceGroups.systemCode,
};

type GroupColumnsRow = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  systemCode: string | null;
};

const activeGroupsOf = (workspaceId: string) => [
  eq(workspaceGroups.workspaceId, workspaceId),
  eq(workspaceGroups.status, WorkspaceGroupStatus.active),
];

export interface ListWorkspaceGroupsInput {
  workspaceId: string;
  offset: number;
  limit: number;
  sort: WorkspaceGroupListSort;
  locale: SortLocale;
  q?: string;
}

/** One page of the workspace's active groups, with their role codes and members. */
export const listWorkspaceGroups = async (
  input: ListWorkspaceGroupsInput,
): Promise<{ items: WorkspaceGroupRow[]; total: number }> => {
  const where = and(
    ...activeGroupsOf(input.workspaceId),
    ...(input.q ? [ilike(workspaceGroups.name, likePattern(input.q))] : []),
  );

  return readListPage(async (tx) => {
    const groups = await tx
      .select(groupColumns)
      .from(workspaceGroups)
      .where(where)
      .orderBy(
        ...orderByForSort(
          WORKSPACE_GROUP_SORT_COLUMNS,
          input.sort,
          workspaceGroups.id,
          input.locale,
        ),
      )
      .limit(input.limit)
      .offset(input.offset);
    const totals = await tx.select({ total: count() }).from(workspaceGroups).where(where);
    return {
      items: await withRolesAndMembers(tx, groups, input.locale),
      total: totals[0]?.total ?? 0,
    };
  });
};

/** Single group with roles and members, or null if it isn't in the workspace. */
export const getWorkspaceGroup = async (
  workspaceId: string,
  groupId: string,
  locale: SortLocale,
): Promise<WorkspaceGroupRow | null> => {
  const groups = await db
    .select(groupColumns)
    .from(workspaceGroups)
    .where(and(...activeGroupsOf(workspaceId), eq(workspaceGroups.id, groupId)));
  const [group] = await withRolesAndMembers(db, groups, locale);
  return group ?? null;
};

/** The groups, in the order given, with their active role codes and active user members. */
const withRolesAndMembers = async (
  executor: DbOrTx,
  groups: GroupColumnsRow[],
  locale: SortLocale,
): Promise<WorkspaceGroupRow[]> => {
  if (!groups.length) return [];

  const groupIds = groups.map((g) => g.id);

  const roleRows = await executor
    .select({ groupId: workspaceGroupRoles.groupId, roleCode: workspaceGroupRoles.roleCode })
    .from(workspaceGroupRoles)
    .where(
      and(
        inArray(workspaceGroupRoles.groupId, groupIds),
        eq(workspaceGroupRoles.status, WorkspaceGroupRoleStatus.active),
      ),
    )
    .orderBy(asc(workspaceGroupRoles.roleCode));

  const userRows = await executor
    .select({
      id: workspaceGroupMemberships.id,
      groupId: workspaceGroupMemberships.groupId,
      membershipId: workspaceGroupMemberships.workspaceMembershipId,
      userId: workspaceMemberships.userId,
      displayLabel: appUsers.displayLabel,
    })
    .from(workspaceGroupMemberships)
    .innerJoin(
      workspaceMemberships,
      eq(workspaceMemberships.id, workspaceGroupMemberships.workspaceMembershipId),
    )
    .innerJoin(appUsers, eq(appUsers.id, workspaceMemberships.userId))
    .where(
      and(
        inArray(workspaceGroupMemberships.groupId, groupIds),
        eq(workspaceGroupMemberships.memberKind, GroupMemberKind.user),
        eq(workspaceGroupMemberships.status, WorkspaceGroupMembershipStatus.active),
        eq(workspaceMemberships.status, WorkspaceMembershipStatus.active),
      ),
    )
    .orderBy(asc(collated(appUsers.displayLabel, locale)));

  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    description: g.description,
    status: g.status,
    system: g.systemCode != null,
    roles: roleRows.filter((r) => r.groupId === g.id).map((r) => r.roleCode),
    members: userRows
      .filter((m) => m.groupId === g.id)
      .map(
        (m): WorkspaceGroupMember => ({
          id: m.id,
          kind: 'user',
          membershipId: m.membershipId as string,
          userId: m.userId,
          displayLabel: m.displayLabel,
        }),
      ),
  }));
};

/** The active group's `systemCode` (null for user-created groups), or null if it isn't in the workspace. */
export const getWorkspaceGroupMeta = async (
  workspaceId: string,
  groupId: string,
): Promise<{ systemCode: string | null } | null> => {
  const rows = await db
    .select({ systemCode: workspaceGroups.systemCode })
    .from(workspaceGroups)
    .where(
      and(
        eq(workspaceGroups.id, groupId),
        eq(workspaceGroups.workspaceId, workspaceId),
        eq(workspaceGroups.status, WorkspaceGroupStatus.active),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
};

/** The id of a workspace's active system group (e.g. form_submitters), or null. */
export const getSystemGroupId = async (
  workspaceId: string,
  systemCode: string,
): Promise<string | null> => {
  const rows = await db
    .select({ id: workspaceGroups.id })
    .from(workspaceGroups)
    .where(
      and(
        eq(workspaceGroups.workspaceId, workspaceId),
        eq(workspaceGroups.systemCode, systemCode),
        eq(workspaceGroups.status, WorkspaceGroupStatus.active),
      ),
    )
    .limit(1);
  return rows[0]?.id ?? null;
};

/**
 * Locks the workspace's Form administrators group row. Every write that can take a member out of
 * it takes this lock first, so two such writes cannot each remove the other's last remaining
 * member. Returns the group id, or null when the workspace has none.
 */
export const lockFormAdmins = async (tx: Tx, workspaceId: string): Promise<string | null> => {
  const rows = await tx
    .select({ id: workspaceGroups.id })
    .from(workspaceGroups)
    .where(
      and(
        eq(workspaceGroups.workspaceId, workspaceId),
        eq(workspaceGroups.systemCode, SystemGroup.form_admins),
        eq(workspaceGroups.status, WorkspaceGroupStatus.active),
      ),
    )
    .for('no key update');
  return rows[0]?.id ?? null;
};

/** True when an active user member other than `membershipId` is in the group. */
export const hasOtherActiveMember = async (
  tx: Tx,
  groupId: string,
  membershipId: string,
): Promise<boolean> => {
  const rows = await tx
    .select({ id: workspaceGroupMemberships.id })
    .from(workspaceGroupMemberships)
    .innerJoin(
      workspaceMemberships,
      eq(workspaceMemberships.id, workspaceGroupMemberships.workspaceMembershipId),
    )
    .where(
      and(
        eq(workspaceGroupMemberships.groupId, groupId),
        eq(workspaceGroupMemberships.memberKind, GroupMemberKind.user),
        eq(workspaceGroupMemberships.status, WorkspaceGroupMembershipStatus.active),
        eq(workspaceMemberships.status, WorkspaceMembershipStatus.active),
        ne(workspaceGroupMemberships.workspaceMembershipId, membershipId),
      ),
    )
    .limit(1);
  return rows.length > 0;
};

/** Refuses when the change would leave Form administrators with no active member. */
export const assertFormAdminsKeepMember = async (
  tx: Tx,
  formAdminsId: string,
  leavingMembershipId: string,
): Promise<void> => {
  if (!(await hasOtherActiveMember(tx, formAdminsId, leavingMembershipId))) {
    throw new ConflictError(LAST_FORM_ADMIN, ApiErrorCodes.last_form_admin);
  }
};

/** True if an active group with this name exists in the workspace (optionally excluding one group). */
export const groupNameExistsInWorkspace = async (
  workspaceId: string,
  name: string,
  exceptGroupId?: string,
): Promise<boolean> => {
  const rows = await db
    .select({ id: workspaceGroups.id })
    .from(workspaceGroups)
    .where(
      and(
        eq(workspaceGroups.workspaceId, workspaceId),
        eq(workspaceGroups.name, name),
        eq(workspaceGroups.status, WorkspaceGroupStatus.active),
        ...(exceptGroupId ? [ne(workspaceGroups.id, exceptGroupId)] : []),
      ),
    )
    .limit(1);
  return Boolean(rows[0]);
};

/** True if the membership id is an active member of the workspace. */
export const membershipInWorkspace = async (
  workspaceId: string,
  membershipId: string,
): Promise<boolean> => {
  const rows = await db
    .select({ id: workspaceMemberships.id })
    .from(workspaceMemberships)
    .where(
      and(
        eq(workspaceMemberships.id, membershipId),
        eq(workspaceMemberships.workspaceId, workspaceId),
        eq(workspaceMemberships.status, WorkspaceMembershipStatus.active),
      ),
    )
    .limit(1);
  return Boolean(rows[0]);
};

/** True if the membership is already a `user` member of the group. */
export const isUserInGroup = async (groupId: string, membershipId: string): Promise<boolean> => {
  const rows = await db
    .select({ id: workspaceGroupMemberships.id })
    .from(workspaceGroupMemberships)
    .where(
      and(
        eq(workspaceGroupMemberships.groupId, groupId),
        eq(workspaceGroupMemberships.workspaceMembershipId, membershipId),
        eq(workspaceGroupMemberships.memberKind, GroupMemberKind.user),
      ),
    )
    .limit(1);
  return Boolean(rows[0]);
};

/** Creates a group carrying the given roles; returns the new group id. */
export const createWorkspaceGroup = (args: {
  workspaceId: string;
  name: string;
  description?: string | null;
  roleCodes: string[];
  displayLabel: string | null;
}): Promise<string> => db.transaction((tx) => createGroupWithRole(tx, args));

/** Replaces a group's role set with `roleCodes`. */
export const replaceGroupRoles = async (args: {
  workspaceId: string;
  groupId: string;
  roleCodes: string[];
  displayLabel: string | null;
}): Promise<void> => {
  await db.transaction(async (tx) => {
    await tx.delete(workspaceGroupRoles).where(eq(workspaceGroupRoles.groupId, args.groupId));
    if (args.roleCodes.length) {
      await tx.insert(workspaceGroupRoles).values(groupRoleRows(args));
    }
  });
};

/** Adds a workspace member to a group. */
export const addGroupMember = async (args: {
  workspaceId: string;
  groupId: string;
  membershipId: string;
  displayLabel: string | null;
}): Promise<void> => {
  await addUserToGroup(db, args);
};

/**
 * Removes a member from a group by its row id; false when it wasn't present. Refuses to take the
 * last active user member out of Form administrators.
 */
export const removeGroupMember = (args: {
  workspaceId: string;
  groupId: string;
  memberId: string;
}): Promise<boolean> =>
  db.transaction(async (tx) => {
    const formAdminsId = await lockFormAdmins(tx, args.workspaceId);
    if (args.groupId === formAdminsId) {
      const [member] = await tx
        .select({
          membershipId: workspaceGroupMemberships.workspaceMembershipId,
          memberKind: workspaceGroupMemberships.memberKind,
          status: workspaceGroupMemberships.status,
        })
        .from(workspaceGroupMemberships)
        .where(
          and(
            eq(workspaceGroupMemberships.id, args.memberId),
            eq(workspaceGroupMemberships.groupId, args.groupId),
          ),
        );
      if (
        member?.membershipId &&
        member.memberKind === GroupMemberKind.user &&
        member.status === WorkspaceGroupMembershipStatus.active
      ) {
        await assertFormAdminsKeepMember(tx, formAdminsId, member.membershipId);
      }
    }
    const rows = await tx
      .delete(workspaceGroupMemberships)
      .where(
        and(
          eq(workspaceGroupMemberships.id, args.memberId),
          eq(workspaceGroupMemberships.groupId, args.groupId),
        ),
      )
      .returning({ id: workspaceGroupMemberships.id });
    return rows.length > 0;
  });

/** Updates a group's name and/or description. */
export const renameGroup = async (args: {
  groupId: string;
  name?: string;
  description?: string | null;
  displayLabel: string | null;
}): Promise<void> => {
  const set: {
    name?: string;
    description?: string | null;
    updatedBy: string | null;
    updatedAt: Date;
  } = {
    updatedBy: args.displayLabel,
    updatedAt: new Date(),
  };
  if (args.name !== undefined) set.name = args.name;
  if (args.description !== undefined) set.description = args.description;
  await db.update(workspaceGroups).set(set).where(eq(workspaceGroups.id, args.groupId));
};

/**
 * Soft-deletes a group: deactivates the group and its roles and memberships in one transaction, so
 * the permission resolver (which filters on active roles/memberships) stops granting through it.
 */
export const softDeleteWorkspaceGroup = async (args: {
  groupId: string;
  displayLabel: string | null;
}): Promise<void> => {
  const stamp = { updatedBy: args.displayLabel, updatedAt: new Date() };
  await db.transaction(async (tx) => {
    // Locked first: a membership write holding the group waits here, so its rows are deactivated
    // below, and one that comes after sees the group inactive.
    await tx
      .select({ id: workspaceGroups.id })
      .from(workspaceGroups)
      .where(eq(workspaceGroups.id, args.groupId))
      .for('update');
    await tx
      .update(workspaceGroupMemberships)
      .set({ status: WorkspaceGroupMembershipStatus.inactive, ...stamp })
      .where(eq(workspaceGroupMemberships.groupId, args.groupId));
    await tx
      .update(workspaceGroupRoles)
      .set({ status: WorkspaceGroupRoleStatus.inactive, ...stamp })
      .where(eq(workspaceGroupRoles.groupId, args.groupId));
    await tx
      .update(workspaceGroups)
      .set({ status: WorkspaceGroupStatus.inactive, ...stamp })
      .where(eq(workspaceGroups.id, args.groupId));
  });
};
