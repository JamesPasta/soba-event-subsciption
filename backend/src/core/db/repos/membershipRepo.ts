import { and, count, eq, ilike, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { WORKSPACE_SORT_FIELDS, type SortLocale, type SortToken } from '@soba/lib';
import { db, type DbOrTx } from '../client';
import {
  appUsers,
  identityProviders,
  userIdentities,
  workspaceDisclaimerAcceptances,
  workspaceMemberships,
  workspaces,
} from '../schema';
import { profileHelpers } from '../../auth/jwtClaims';
import { ForbiddenError } from '../../errors';
import type { NormalizedProfile, IdpAttributes } from '../../auth/jwtClaims';
import { WorkspaceMembershipRole, WorkspaceMembershipStatus } from '../codes';
import { likePattern, orderByForSort, type SortColumns } from '../listSort';
import { readListPage } from '../listRead';
import { membershipHoldsPermission } from './formAccessRepo';

/** Second int for `pg_advisory_xact_lock`; must not collide with the other advisory lock ids. */
const ADV_LOCK_FIND_OR_CREATE_IDENTITY = 2_147_483_622;

export { findUserIdByIdentity } from './identityLookup';

/** Stores the identity's IdP attributes; writes nothing when the stored ones already match. */
export const updateIdentityAttributes = async (
  identityId: string,
  idpAttributes: IdpAttributes,
  executor: DbOrTx = db,
): Promise<void> => {
  await executor
    .update(userIdentities)
    .set({ idpAttributes, updatedAt: new Date() })
    .where(
      and(
        eq(userIdentities.id, identityId),
        sql`${userIdentities.idpAttributes} is distinct from ${JSON.stringify(idpAttributes)}::jsonb`,
      ),
    );
};

/**
 * Serialises creating one identity, by sign-in or from a directory: hashtext(provider, subject)
 * under a fixed namespace int. The subject is lower-cased, as identities match without case.
 */
const lockIdentity = (tx: DbOrTx, providerCode: string, subject: string) => {
  const payload = `${providerCode}\u001f${subject.toLowerCase()}`;
  return tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${payload}::text), ${ADV_LOCK_FIND_OR_CREATE_IDENTITY})`,
  );
};

/** The identity for the provider and subject, matched without case; an exact spelling wins. */
const findIdentity = async (tx: DbOrTx, providerCode: string, subject: string) => {
  const rows = await tx
    .select({
      id: userIdentities.id,
      userId: userIdentities.userId,
      firstSignInAt: userIdentities.firstSignInAt,
    })
    .from(userIdentities)
    .where(
      and(
        eq(userIdentities.identityProviderCode, providerCode),
        sql`lower(${userIdentities.subject}) = ${subject.toLowerCase()}`,
      ),
    )
    .orderBy(sql`${userIdentities.subject} = ${subject} desc`)
    .limit(1);
  return rows[0] ?? null;
};

/** Inserts a user and its identity. Returns the user id. */
const insertUserWithIdentity = async (
  tx: DbOrTx,
  args: {
    providerCode: string;
    subject: string;
    profile: NormalizedProfile | null | undefined;
    idpAttributes: IdpAttributes | null | undefined;
    firstSignInAt: Date | null;
    /** The audit stamp; defaults to the new user's own label. */
    createdBy?: string | null;
  },
): Promise<string> => {
  const displayLabel = profileHelpers.getDisplayLabel(args.profile, args.subject) ?? args.subject;
  const stamp = args.createdBy === undefined ? displayLabel : args.createdBy;
  const createdUser = await tx
    .insert(appUsers)
    .values({
      id: uuidv7(),
      displayLabel,
      profile: args.profile ?? { displayName: args.subject },
      status: 'active',
      createdBy: stamp,
      updatedBy: stamp,
    })
    .returning({ id: appUsers.id });
  const userId = createdUser[0].id;
  await tx.insert(userIdentities).values({
    id: uuidv7(),
    userId,
    identityProviderCode: args.providerCode,
    subject: args.subject,
    idpAttributes: args.idpAttributes ?? undefined,
    firstSignInAt: args.firstSignInAt,
    createdBy: stamp,
    updatedBy: stamp,
  });
  return userId;
};

export const findOrCreateUserByIdentity = (
  providerCode: string,
  subject: string,
  profile?: NormalizedProfile | null,
  idpAttributes?: IdpAttributes | null,
) => {
  return db.transaction(async (tx) => {
    const normalizedProvider = providerCode.toLowerCase();
    const providerRow = await tx
      .select()
      .from(identityProviders)
      .where(eq(identityProviders.code, normalizedProvider))
      .limit(1);
    const provider = providerRow[0];

    // Only identity providers present AND active in identity_provider may authenticate.
    // Unknown or deactivated IdPs are rejected.
    if (!provider?.isActive) {
      throw new ForbiddenError(
        `Identity provider '${normalizedProvider}' is not enabled for sign-in`,
      );
    }

    await lockIdentity(tx, provider.code, subject);

    const existingRow = await findIdentity(tx, provider.code, subject);

    if (existingRow) {
      // No sign-in has used this identity yet, as with one made from user search.
      if (!existingRow.firstSignInAt) {
        await markFirstSignIn(tx, {
          identityId: existingRow.id,
          userId: existingRow.userId,
          subject,
          profile,
          idpAttributes: idpAttributes ?? {},
        });
      } else if (idpAttributes != null) {
        await updateIdentityAttributes(existingRow.id, idpAttributes, tx);
      }
      return existingRow.userId;
    }

    return insertUserWithIdentity(tx, {
      providerCode: provider.code,
      subject,
      profile,
      idpAttributes,
      firstSignInAt: new Date(),
    });
  });
};

/**
 * The user holding this identity, or a new one made from directory details for a person who has
 * not signed in. The new identity's first sign-in stays unset, so that sign-in replaces the profile
 * with the token's. Subjects match without case, as user search matches them.
 */
export const findOrCreateUserFromDirectory = (args: {
  providerCode: string;
  subject: string;
  profile: NormalizedProfile;
  actorDisplayLabel: string | null;
}): Promise<{ userId: string; created: boolean }> =>
  db.transaction(async (tx) => {
    await lockIdentity(tx, args.providerCode, args.subject);
    const existing = await findIdentity(tx, args.providerCode, args.subject);
    if (existing) return { userId: existing.userId, created: false };
    const userId = await insertUserWithIdentity(tx, {
      providerCode: args.providerCode,
      subject: args.subject,
      profile: args.profile,
      idpAttributes: null,
      firstSignInAt: null,
      createdBy: args.actorDisplayLabel,
    });
    return { userId, created: true };
  });

interface FirstSignIn {
  identityId: string;
  userId: string;
  subject: string;
  profile: NormalizedProfile | null | undefined;
  idpAttributes: IdpAttributes;
}

/**
 * Marks the identity's first sign-in. The request that marks it also replaces the user's profile
 * and display label with the token's, keeping stored preferences. Returns whether it marked it.
 */
async function markFirstSignIn(tx: DbOrTx, args: FirstSignIn): Promise<boolean> {
  const now = new Date();
  const marked = await tx
    .update(userIdentities)
    .set({ firstSignInAt: now, idpAttributes: args.idpAttributes, updatedAt: now })
    .where(and(eq(userIdentities.id, args.identityId), isNull(userIdentities.firstSignInAt)))
    .returning({ id: userIdentities.id });
  if (!marked[0]) return false;

  const users = await tx
    .select({ profile: appUsers.profile })
    .from(appUsers)
    .where(eq(appUsers.id, args.userId))
    .for('update');
  const preferences = (users[0]?.profile as NormalizedProfile | null)?.preferences;
  const displayLabel = profileHelpers.getDisplayLabel(args.profile, args.subject) ?? args.subject;
  await tx
    .update(appUsers)
    .set({
      profile: {
        ...(args.profile ?? { displayName: args.subject }),
        ...(preferences && { preferences }),
      },
      displayLabel,
      updatedBy: displayLabel,
      updatedAt: now,
    })
    .where(eq(appUsers.id, args.userId));
  return true;
}

/** markFirstSignIn in its own transaction. */
export const completeFirstSignIn = (args: FirstSignIn): Promise<boolean> =>
  db.transaction((tx) => markFirstSignIn(tx, args));

export const actorBelongsToWorkspace = async (workspaceId: string, userId: string) => {
  const row = await db
    .select({ id: workspaceMemberships.id })
    .from(workspaceMemberships)
    .where(
      and(
        eq(workspaceMemberships.workspaceId, workspaceId),
        eq(workspaceMemberships.userId, userId),
        eq(workspaceMemberships.status, 'active'),
      ),
    )
    .limit(1);

  return Boolean(row[0]);
};

export const getWorkspaceForUser = async (workspaceId: string, userId: string) => {
  const row = await db
    .select({
      id: workspaces.id,
      kind: workspaces.kind,
      name: workspaces.name,
      org: workspaces.org,
      useCase: workspaces.useCase,
      status: workspaces.status,
      membershipId: workspaceMemberships.id,
      role: workspaceMemberships.role,
      disclaimerAcceptedAt: workspaceDisclaimerAcceptances.acceptedAt,
    })
    .from(workspaces)
    .innerJoin(
      workspaceMemberships,
      and(
        eq(workspaceMemberships.workspaceId, workspaces.id),
        eq(workspaceMemberships.userId, userId),
        eq(workspaceMemberships.status, 'active'),
      ),
    )
    .leftJoin(
      workspaceDisclaimerAcceptances,
      eq(workspaceDisclaimerAcceptances.workspaceId, workspaces.id),
    )
    .where(eq(workspaces.id, workspaceId))
    .limit(1);

  return row[0] ?? null;
};

/** The owner membership role alone. */
export const isWorkspaceOwnerRole = (role: string | null): boolean =>
  role === WorkspaceMembershipRole.owner;

/** Owner or admin membership roles may manage or mutate workspace settings. */
export const isWorkspaceManageRole = (role: string | null): boolean =>
  role === WorkspaceMembershipRole.owner || role === WorkspaceMembershipRole.admin;

/** Owner, admin and member roles may read the workspace's members and groups; a viewer may not. */
export const isWorkspacePeopleReadRole = (role: string | null): boolean =>
  isWorkspaceManageRole(role) || role === WorkspaceMembershipRole.member;

/**
 * All workspace ids the user is an active member of. Used to scope cross-workspace list/search
 * queries when no specific `workspaceId` filter is supplied.
 */
export const getActiveWorkspaceIdsForUser = async (userId: string): Promise<string[]> => {
  const rows = await db
    .select({ workspaceId: workspaceMemberships.workspaceId })
    .from(workspaceMemberships)
    .where(and(eq(workspaceMemberships.userId, userId), eq(workspaceMemberships.status, 'active')));

  return rows.map((row) => row.workspaceId);
};

/** A user's display label and their active membership role in one workspace, null for none. */
export interface ActorMembership {
  displayLabel: string | null;
  role: string | null;
}

/**
 * The user's display label and their active membership role in the workspace, read together.
 * Returns null when the user row is gone.
 */
export const findActorMembership = async (
  workspaceId: string,
  userId: string,
): Promise<ActorMembership | null> => {
  const rows = await db
    .select({ displayLabel: appUsers.displayLabel, role: workspaceMemberships.role })
    .from(appUsers)
    .leftJoin(
      workspaceMemberships,
      and(
        eq(workspaceMemberships.userId, appUsers.id),
        eq(workspaceMemberships.workspaceId, workspaceId),
        eq(workspaceMemberships.status, WorkspaceMembershipStatus.active),
      ),
    )
    .where(eq(appUsers.id, userId))
    .limit(1);
  return rows[0] ?? null;
};

export type WorkspaceListSortField = (typeof WORKSPACE_SORT_FIELDS)[number];
export type WorkspaceListSort = SortToken<WorkspaceListSortField>;

const WORKSPACE_SORT_COLUMNS: SortColumns<WorkspaceListSortField> = {
  name: { column: workspaces.name, linguistic: true },
  kind: { column: workspaces.kind },
  status: { column: workspaces.status },
  updatedAt: { column: workspaces.updatedAt },
};

export interface WorkspaceMembershipFilter {
  userId: string;
  kind?: string;
  status?: string;
  q?: string;
  /** Every code must be held, through one of the actor's groups or the `*` wildcard. */
  requiredPermissions?: readonly string[];
  disclaimerAccepted?: boolean;
}

export interface ListWorkspacesForUserInput extends WorkspaceMembershipFilter {
  offset: number;
  limit: number;
  sort: WorkspaceListSort;
  locale: SortLocale;
}

export interface WorkspaceListRow {
  id: string;
  name: string;
  kind: string;
  role: string;
  status: string;
  org: string | null;
  useCase: string | null;
  disclaimerAcceptedAt: Date | null;
  updatedAt: Date;
}

/** Expects workspace_membership joined to workspace and left joined to the disclaimer acceptance. */
const workspaceMembershipWhere = (filter: WorkspaceMembershipFilter) => {
  const whereClauses = [
    eq(workspaceMemberships.userId, filter.userId),
    eq(workspaceMemberships.status, 'active'),
  ];
  if (filter.kind) {
    whereClauses.push(eq(workspaces.kind, filter.kind));
  }
  if (filter.status) {
    whereClauses.push(eq(workspaces.status, filter.status));
  }
  if (filter.q) {
    const pattern = likePattern(filter.q);
    whereClauses.push(or(ilike(workspaces.name, pattern), ilike(workspaces.org, pattern)));
  }
  for (const code of new Set(filter.requiredPermissions)) {
    whereClauses.push(membershipHoldsPermission(code));
  }
  if (filter.disclaimerAccepted !== undefined) {
    const acceptedAt = workspaceDisclaimerAcceptances.acceptedAt;
    whereClauses.push(filter.disclaimerAccepted ? isNotNull(acceptedAt) : isNull(acceptedAt));
  }
  return and(...whereClauses);
};

export interface WorkspaceLookupRow {
  id: string;
  name: string;
  kind: string;
  role: string;
  disclaimerAcceptedAt: Date | null;
}

/** Workspaces for a select, in name order. */
export const lookupWorkspacesForUser = (
  input: WorkspaceMembershipFilter & { limit: number; locale: SortLocale },
): Promise<WorkspaceLookupRow[]> =>
  db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      kind: workspaces.kind,
      role: workspaceMemberships.role,
      disclaimerAcceptedAt: workspaceDisclaimerAcceptances.acceptedAt,
    })
    .from(workspaceMemberships)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMemberships.workspaceId))
    .leftJoin(
      workspaceDisclaimerAcceptances,
      eq(workspaceDisclaimerAcceptances.workspaceId, workspaces.id),
    )
    .where(workspaceMembershipWhere(input))
    .orderBy(...orderByForSort(WORKSPACE_SORT_COLUMNS, 'name:asc', workspaces.id, input.locale))
    .limit(input.limit);

export const hasActiveMembership = async (userId: string): Promise<boolean> => {
  const rows = await db
    .select({ id: workspaceMemberships.id })
    .from(workspaceMemberships)
    .where(and(eq(workspaceMemberships.userId, userId), eq(workspaceMemberships.status, 'active')))
    .limit(1);
  return rows.length > 0;
};

/**
 * A workspace where the user holds every required code, preferring one whose disclaimer is
 * accepted. Null when there is none.
 */
export const findPermittedWorkspace = async (
  userId: string,
  requiredPermissions: readonly string[],
): Promise<{ disclaimerAccepted: boolean } | null> => {
  const rows = await db
    .select({ acceptedAt: workspaceDisclaimerAcceptances.acceptedAt })
    .from(workspaceMemberships)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMemberships.workspaceId))
    .leftJoin(
      workspaceDisclaimerAcceptances,
      eq(workspaceDisclaimerAcceptances.workspaceId, workspaces.id),
    )
    .where(workspaceMembershipWhere({ userId, requiredPermissions }))
    .orderBy(sql`${workspaceDisclaimerAcceptances.acceptedAt} is null`)
    .limit(1);
  return rows[0] ? { disclaimerAccepted: rows[0].acceptedAt != null } : null;
};

export const listWorkspacesForUser = async (
  input: ListWorkspacesForUserInput,
): Promise<{ items: WorkspaceListRow[]; total: number }> => {
  const where = workspaceMembershipWhere(input);

  return readListPage(async (tx) => {
    const items = await tx
      .select({
        id: workspaces.id,
        name: workspaces.name,
        kind: workspaces.kind,
        role: workspaceMemberships.role,
        status: workspaces.status,
        org: workspaces.org,
        useCase: workspaces.useCase,
        disclaimerAcceptedAt: workspaceDisclaimerAcceptances.acceptedAt,
        updatedAt: workspaces.updatedAt,
      })
      .from(workspaceMemberships)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMemberships.workspaceId))
      .leftJoin(
        workspaceDisclaimerAcceptances,
        eq(workspaceDisclaimerAcceptances.workspaceId, workspaces.id),
      )
      .where(where)
      .orderBy(...orderByForSort(WORKSPACE_SORT_COLUMNS, input.sort, workspaces.id, input.locale))
      .limit(input.limit)
      .offset(input.offset);

    // Mirrors the page query's joins. The acceptance join is 1:0-or-1 only because workspace_id is
    // that table's primary key; per-user acceptance would multiply page rows and not the count.
    const totals = await tx
      .select({ total: count() })
      .from(workspaceMemberships)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMemberships.workspaceId))
      .leftJoin(
        workspaceDisclaimerAcceptances,
        eq(workspaceDisclaimerAcceptances.workspaceId, workspaces.id),
      )
      .where(where);

    return { items, total: totals[0]?.total ?? 0 };
  });
};

export interface WorkspaceMemberRow {
  id: string;
  userId: string;
  displayLabel: string | null;
  role: string;
  status: string;
  updatedAt: Date;
}

export const MEMBER_SORT_FIELDS = ['displayLabel', 'role', 'status'] as const;
export type MemberListSortField = (typeof MEMBER_SORT_FIELDS)[number];
export type MemberListSort = SortToken<MemberListSortField>;

const MEMBER_SORT_COLUMNS: SortColumns<MemberListSortField> = {
  // A user who has never signed in has no label yet.
  displayLabel: { column: appUsers.displayLabel, nullable: true, linguistic: true },
  role: { column: workspaceMemberships.role },
  status: { column: workspaceMemberships.status },
};

export interface ListMembersForWorkspaceInput {
  workspaceId: string;
  offset: number;
  limit: number;
  sort: MemberListSort;
  locale: SortLocale;
  role?: string;
  status?: string;
  q?: string;
}

export const listMembersForWorkspace = async (
  input: ListMembersForWorkspaceInput,
): Promise<{ items: WorkspaceMemberRow[]; total: number }> => {
  const whereClauses = [eq(workspaceMemberships.workspaceId, input.workspaceId)];
  if (input.role) {
    whereClauses.push(eq(workspaceMemberships.role, input.role));
  }
  if (input.status) {
    whereClauses.push(eq(workspaceMemberships.status, input.status));
  }
  if (input.q) {
    whereClauses.push(ilike(appUsers.displayLabel, likePattern(input.q)));
  }

  const where = and(...whereClauses);

  return readListPage(async (tx) => {
    const items = await tx
      .select({
        id: workspaceMemberships.id,
        userId: workspaceMemberships.userId,
        displayLabel: appUsers.displayLabel,
        role: workspaceMemberships.role,
        status: workspaceMemberships.status,
        updatedAt: workspaceMemberships.updatedAt,
      })
      .from(workspaceMemberships)
      .innerJoin(appUsers, eq(appUsers.id, workspaceMemberships.userId))
      .where(where)
      .orderBy(
        ...orderByForSort(MEMBER_SORT_COLUMNS, input.sort, workspaceMemberships.id, input.locale),
      )
      .limit(input.limit)
      .offset(input.offset);
    const totals = await tx
      .select({ total: count() })
      .from(workspaceMemberships)
      .innerJoin(appUsers, eq(appUsers.id, workspaceMemberships.userId))
      .where(where);
    return { items, total: totals[0]?.total ?? 0 };
  });
};
