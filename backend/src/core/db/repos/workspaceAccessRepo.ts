import { and, asc, count, eq, exists, ilike, inArray, or, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import {
  ApiErrorCodes,
  WORKSPACE_ACCESS_SORT_FIELDS,
  type SortLocale,
  type SortToken,
  type WorkspaceAccessInclude,
} from '@soba/lib';
import { db, type DbOrTx, type Tx } from '../client';
import { collated, likePattern, orderByForSort, type SortColumns } from '../listSort';
import { readListPage } from '../listRead';
import {
  appUsers,
  formGroupOverrideMembers,
  identityProviders,
  userIdentities,
  workspaceGroupMemberships,
  workspaceGroups,
  workspaceMemberships,
} from '../schema';
import {
  GroupMemberKind,
  WorkspaceGroupMembershipStatus,
  WorkspaceGroupStatus,
  WorkspaceMembershipRole,
  WorkspaceMembershipSource,
  WorkspaceMembershipStatus,
  type WorkspaceMembershipRoleCode,
} from '../codes';
import { ConflictError, NotFoundError, ValidationError } from '../../errors';
import {
  MEMBER_EXISTS,
  MEMBER_NOT_FOUND,
  MEMBER_PROTECTED,
  USER_NOT_ADDABLE,
} from '../../messages';
import { assertFormAdminsKeepMember, lockFormAdmins } from './workspaceGroupRepo';

export type WorkspaceAccessSortField = (typeof WORKSPACE_ACCESS_SORT_FIELDS)[number];
export type WorkspaceAccessSort = SortToken<WorkspaceAccessSortField>;

const WORKSPACE_ACCESS_SORT_COLUMNS: SortColumns<WorkspaceAccessSortField> = {
  // A user who has never signed in has no label yet.
  displayLabel: { column: appUsers.displayLabel, nullable: true, linguistic: true },
};

const emailOf = sql<string | null>`${appUsers.profile}->>'email'`;

export interface WorkspaceAccessGroup {
  id: string;
  name: string;
}

export interface WorkspaceAccessRow {
  membershipId: string;
  userId: string;
  displayLabel: string | null;
  email: string | null;
  role: string;
  groups: WorkspaceAccessGroup[];
}

type MemberColumnsRow = Omit<WorkspaceAccessRow, 'groups'>;

const memberColumns = {
  membershipId: workspaceMemberships.id,
  userId: workspaceMemberships.userId,
  displayLabel: appUsers.displayLabel,
  email: emailOf,
  role: workspaceMemberships.role,
};

const activeMembersOf = (workspaceId: string) => [
  eq(workspaceMemberships.workspaceId, workspaceId),
  eq(workspaceMemberships.status, WorkspaceMembershipStatus.active),
];

/** Active `user` rows in active groups. Expects workspace_group joined on the row's group. */
const activeUserRowInActiveGroup = and(
  eq(workspaceGroupMemberships.memberKind, GroupMemberKind.user),
  eq(workspaceGroupMemberships.status, WorkspaceGroupMembershipStatus.active),
  eq(workspaceGroups.status, WorkspaceGroupStatus.active),
);

/** The outer workspace_membership row is in at least one active group. */
const inSomeGroup = () =>
  exists(
    db
      .select({ id: workspaceGroupMemberships.id })
      .from(workspaceGroupMemberships)
      .innerJoin(workspaceGroups, eq(workspaceGroups.id, workspaceGroupMemberships.groupId))
      .where(
        and(
          eq(workspaceGroupMemberships.workspaceMembershipId, workspaceMemberships.id),
          activeUserRowInActiveGroup,
        ),
      ),
  );

export interface ListWorkspaceAccessInput {
  workspaceId: string;
  offset: number;
  limit: number;
  sort: WorkspaceAccessSort;
  locale: SortLocale;
  include: WorkspaceAccessInclude;
  q?: string;
}

/** One page of the workspace's active members, with the active groups each is in. */
export const listWorkspaceAccess = async (
  input: ListWorkspaceAccessInput,
): Promise<{ items: WorkspaceAccessRow[]; total: number }> => {
  const pattern = input.q ? likePattern(input.q) : null;
  const where = and(
    ...activeMembersOf(input.workspaceId),
    ...(input.include === 'grouped' ? [inSomeGroup()] : []),
    ...(pattern ? [or(ilike(appUsers.displayLabel, pattern), ilike(emailOf, pattern))] : []),
  );

  return readListPage(async (tx) => {
    const members = await tx
      .select(memberColumns)
      .from(workspaceMemberships)
      .innerJoin(appUsers, eq(appUsers.id, workspaceMemberships.userId))
      .where(where)
      .orderBy(
        ...orderByForSort(
          WORKSPACE_ACCESS_SORT_COLUMNS,
          input.sort,
          workspaceMemberships.id,
          input.locale,
        ),
      )
      .limit(input.limit)
      .offset(input.offset);
    const totals = await tx
      .select({ total: count() })
      .from(workspaceMemberships)
      .innerJoin(appUsers, eq(appUsers.id, workspaceMemberships.userId))
      .where(where);
    return {
      items: await withGroups(tx, members, input.locale),
      total: totals[0]?.total ?? 0,
    };
  });
};

/** One active member with their groups, or null if the membership isn't active in the workspace. */
export const getWorkspaceAccess = async (
  workspaceId: string,
  membershipId: string,
  locale: SortLocale,
): Promise<WorkspaceAccessRow | null> => {
  const members = await db
    .select(memberColumns)
    .from(workspaceMemberships)
    .innerJoin(appUsers, eq(appUsers.id, workspaceMemberships.userId))
    .where(and(...activeMembersOf(workspaceId), eq(workspaceMemberships.id, membershipId)));
  const [member] = await withGroups(db, members, locale);
  return member ?? null;
};

/** The members, in the order given, with their active groups by name. */
const withGroups = async (
  executor: DbOrTx,
  members: MemberColumnsRow[],
  locale: SortLocale,
): Promise<WorkspaceAccessRow[]> => {
  if (!members.length) return [];

  const rows = await executor
    .select({
      membershipId: workspaceGroupMemberships.workspaceMembershipId,
      id: workspaceGroups.id,
      name: workspaceGroups.name,
    })
    .from(workspaceGroupMemberships)
    .innerJoin(workspaceGroups, eq(workspaceGroups.id, workspaceGroupMemberships.groupId))
    .where(
      and(
        inArray(
          workspaceGroupMemberships.workspaceMembershipId,
          members.map((m) => m.membershipId),
        ),
        activeUserRowInActiveGroup,
      ),
    )
    .orderBy(asc(collated(workspaceGroups.name, locale)), asc(workspaceGroups.id));

  return members.map((m) => ({
    ...m,
    groups: rows
      .filter((r) => r.membershipId === m.membershipId)
      .map(({ id, name }) => ({ id, name })),
  }));
};

/** Locks the active membership and returns its user and role. Not found when it isn't active. */
const lockActiveMembership = async (
  tx: Tx,
  workspaceId: string,
  membershipId: string,
): Promise<{ userId: string; role: string }> => {
  const rows = await tx
    .select({ userId: workspaceMemberships.userId, role: workspaceMemberships.role })
    .from(workspaceMemberships)
    .where(and(...activeMembersOf(workspaceId), eq(workspaceMemberships.id, membershipId)))
    .for('update');
  if (!rows[0]) {
    throw new NotFoundError(MEMBER_NOT_FOUND);
  }
  return rows[0];
};

/**
 * Locks the groups, which must all be active in the workspace, so none is deleted before the
 * transaction commits. Returns the ids without repeats.
 */
const lockActiveGroups = async (
  tx: Tx,
  workspaceId: string,
  groupIds: string[],
): Promise<string[]> => {
  const ids = [...new Set(groupIds)];
  if (!ids.length) return ids;
  const rows = await tx
    .select({ id: workspaceGroups.id })
    .from(workspaceGroups)
    .where(
      and(
        eq(workspaceGroups.workspaceId, workspaceId),
        eq(workspaceGroups.status, WorkspaceGroupStatus.active),
        inArray(workspaceGroups.id, ids),
      ),
    )
    .for('share');
  const found = new Set(rows.map((r) => r.id));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length) {
    throw new ValidationError(`Unknown group id(s): ${missing.join(', ')}`);
  }
  return ids;
};

/**
 * Locks the user, who must be active and hold an identity at a sign-in provider. That leaves out
 * the public and system users.
 */
const lockAddableUser = async (tx: Tx, userId: string): Promise<void> => {
  const users = await tx
    .select({ id: appUsers.id })
    .from(appUsers)
    .where(and(eq(appUsers.id, userId), eq(appUsers.status, 'active')))
    .for('share');
  const identities = users[0]
    ? await tx
        .select({ id: userIdentities.id })
        .from(userIdentities)
        .innerJoin(
          identityProviders,
          and(
            eq(identityProviders.code, userIdentities.identityProviderCode),
            eq(identityProviders.isLoginProvider, true),
          ),
        )
        .where(eq(userIdentities.userId, userId))
        .limit(1)
    : [];
  if (!identities[0]) {
    throw new ValidationError(USER_NOT_ADDABLE);
  }
};

interface GroupSetArgs {
  workspaceId: string;
  membershipId: string;
  groupIds: string[];
  displayLabel: string | null;
}

/**
 * Makes `groupIds` the membership's set of active groups in the workspace, leaving rows that stay
 * untouched. An inactive row in an active group is replaced: the unique index covers every status.
 * Refuses to take the last member out of Form administrators.
 */
const applyGroupSet = async (tx: Tx, args: GroupSetArgs): Promise<void> => {
  const formAdminsId = await lockFormAdmins(tx, args.workspaceId);
  const groupIds = await lockActiveGroups(tx, args.workspaceId, args.groupIds);
  const rows = await tx
    .select({
      id: workspaceGroupMemberships.id,
      groupId: workspaceGroupMemberships.groupId,
      status: workspaceGroupMemberships.status,
    })
    .from(workspaceGroupMemberships)
    .innerJoin(workspaceGroups, eq(workspaceGroups.id, workspaceGroupMemberships.groupId))
    .where(
      and(
        eq(workspaceGroupMemberships.workspaceMembershipId, args.membershipId),
        eq(workspaceGroupMemberships.memberKind, GroupMemberKind.user),
        eq(workspaceGroups.workspaceId, args.workspaceId),
        eq(workspaceGroups.status, WorkspaceGroupStatus.active),
      ),
    );

  const wanted = new Set(groupIds);
  const isActive = (row: { status: string }) =>
    row.status === WorkspaceGroupMembershipStatus.active;
  const kept = new Set(
    rows.filter((r) => isActive(r) && wanted.has(r.groupId)).map((r) => r.groupId),
  );
  const stale = rows.filter((r) => !isActive(r) || !wanted.has(r.groupId));

  if (formAdminsId && stale.some((r) => isActive(r) && r.groupId === formAdminsId)) {
    await assertFormAdminsKeepMember(tx, formAdminsId, args.membershipId);
  }

  if (stale.length) {
    await tx.delete(workspaceGroupMemberships).where(
      inArray(
        workspaceGroupMemberships.id,
        stale.map((r) => r.id),
      ),
    );
  }
  const added = groupIds.filter((groupId) => !kept.has(groupId));
  if (added.length) {
    await tx.insert(workspaceGroupMemberships).values(
      added.map((groupId) => ({
        id: uuidv7(),
        workspaceId: args.workspaceId,
        workspaceMembershipId: args.membershipId,
        groupId,
        status: WorkspaceGroupMembershipStatus.active,
        createdBy: args.displayLabel,
        updatedBy: args.displayLabel,
      })),
    );
  }
};

/**
 * Gives the user an active membership in the workspace with `role`, reactivating an inactive or
 * pending one, and puts it in `groupIds`. A reactivated membership takes `role` too, whatever it
 * held before. Refuses a user who is already an active member. Returns the membership id.
 */
export const addWorkspaceAccess = (args: {
  workspaceId: string;
  userId: string;
  groupIds: string[];
  role: WorkspaceMembershipRoleCode;
  actorId: string;
  displayLabel: string | null;
}): Promise<string> =>
  db.transaction(async (tx) => {
    await lockAddableUser(tx, args.userId);
    const now = new Date();
    const grant = {
      role: args.role,
      status: WorkspaceMembershipStatus.active,
      invitedByUserId: args.actorId,
      invitedAt: now,
      acceptedAt: now,
      updatedBy: args.displayLabel,
      updatedAt: now,
    };
    const existing = await tx
      .select({ id: workspaceMemberships.id, status: workspaceMemberships.status })
      .from(workspaceMemberships)
      .where(
        and(
          eq(workspaceMemberships.workspaceId, args.workspaceId),
          eq(workspaceMemberships.userId, args.userId),
        ),
      )
      .for('update');

    let membershipId: string;
    if (existing[0]) {
      if (existing[0].status === WorkspaceMembershipStatus.active) {
        throw new ConflictError(MEMBER_EXISTS, ApiErrorCodes.member_exists);
      }
      membershipId = existing[0].id;
      await tx
        .update(workspaceMemberships)
        .set(grant)
        .where(eq(workspaceMemberships.id, membershipId));
    } else {
      // A concurrent add of the same user inserts nothing here.
      const inserted = await tx
        .insert(workspaceMemberships)
        .values({
          id: uuidv7(),
          workspaceId: args.workspaceId,
          userId: args.userId,
          source: WorkspaceMembershipSource.user_created,
          createdBy: args.displayLabel,
          ...grant,
        })
        .onConflictDoNothing()
        .returning({ id: workspaceMemberships.id });
      if (!inserted[0]) {
        throw new ConflictError(MEMBER_EXISTS, ApiErrorCodes.member_exists);
      }
      membershipId = inserted[0].id;
    }

    await applyGroupSet(tx, { ...args, membershipId });
    return membershipId;
  });

/** Replaces the active membership's set of groups in the workspace. */
export const setWorkspaceAccessGroups = (args: GroupSetArgs): Promise<void> =>
  db.transaction(async (tx) => {
    await lockActiveMembership(tx, args.workspaceId, args.membershipId);
    await applyGroupSet(tx, args);
  });

/**
 * Takes the membership out of every group and form override in the workspace and makes it
 * inactive. Refuses the owner and the actor's own membership.
 */
export const removeWorkspaceAccess = (args: {
  workspaceId: string;
  membershipId: string;
  actorId: string;
  displayLabel: string | null;
}): Promise<void> =>
  db.transaction(async (tx) => {
    const membership = await lockActiveMembership(tx, args.workspaceId, args.membershipId);
    if (membership.role === WorkspaceMembershipRole.owner || membership.userId === args.actorId) {
      throw new ConflictError(MEMBER_PROTECTED, ApiErrorCodes.member_protected);
    }
    await applyGroupSet(tx, { ...args, groupIds: [] });
    const stamp = { updatedBy: args.displayLabel, updatedAt: new Date() };
    // Override rows are read through the membership, so a later re-add would bring them back.
    await tx
      .update(formGroupOverrideMembers)
      .set({ status: WorkspaceGroupMembershipStatus.inactive, ...stamp })
      .where(
        and(
          eq(formGroupOverrideMembers.workspaceMembershipId, args.membershipId),
          eq(formGroupOverrideMembers.status, WorkspaceGroupMembershipStatus.active),
        ),
      );
    await tx
      .update(workspaceMemberships)
      .set({ status: WorkspaceMembershipStatus.inactive, ...stamp })
      .where(eq(workspaceMemberships.id, args.membershipId));
  });
