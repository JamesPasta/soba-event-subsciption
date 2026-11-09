import { and, eq, ne, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { ApiErrorCodes } from '@soba/lib';
import {
  FORM_ADMINS_GROUP_NAME,
  FORM_SUBMITTERS_GROUP_NAME,
  Roles,
  SystemGroup,
  WorkspaceKind,
  WorkspaceMembershipRole,
  WorkspaceMembershipSource,
  WorkspaceMembershipStatus,
  WorkspaceStatus,
} from '../codes';
import { db, type DbOrTx } from '../client';
import { isUniqueViolationOn } from '../pgError';
import {
  appUsers,
  WORKSPACE_KIND_ORG_NAME_UNIQUE,
  workspaceDisclaimerAcceptances,
  workspaceMemberships,
  workspaces,
} from '../schema';
import { ConflictError } from '../../errors';
import { WORKSPACE_NAME_TAKEN } from '../../messages';
import { getWorkspaceForUser, isWorkspaceManageRole } from './membershipRepo';
import { addUserToGroup, createGroupWithRole } from './workspaceGroupRepo';
import { createWorkspaceSettings } from '../../../features/form-settings/create';

const workspaceNameTaken = () =>
  new ConflictError(WORKSPACE_NAME_TAKEN, ApiErrorCodes.workspace_name_taken);

/**
 * Two saves can both pass the pre-check and race to the write; the loser hits the name's unique
 * index. That is the same conflict the pre-check reports, so it gets the same code.
 */
const nameConflictOr = (err: unknown): unknown =>
  isUniqueViolationOn(err, WORKSPACE_KIND_ORG_NAME_UNIQUE) ? workspaceNameTaken() : err;

/**
 * True if a workspace of this kind and org already uses this name, case-insensitively (optionally
 * excluding one workspace). Mirrors `workspace_kind_org_name_uq`.
 */
export const workspaceNameExistsForKindAndOrg = async (
  kind: string,
  org: string,
  name: string,
  exceptId?: string,
): Promise<boolean> => {
  const rows = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(
      and(
        eq(workspaces.kind, kind),
        eq(workspaces.org, org),
        sql`lower(${workspaces.name}) = lower(${name})`,
        ...(exceptId ? [ne(workspaces.id, exceptId)] : []),
      ),
    )
    .limit(1);
  return Boolean(rows[0]);
};

/** Returns the workspace's id if it exists, otherwise null. Used to distinguish 404 from 403. */
export const getWorkspaceById = async (workspaceId: string): Promise<{ id: string } | null> => {
  const rows = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  return rows[0] ?? null;
};

const bootstrapWorkspaceOwner = async (
  tx: DbOrTx,
  workspaceId: string,
  userId: string,
  displayLabel: string | null,
  source: string,
) => {
  const membershipId = uuidv7();
  await tx.insert(workspaceMemberships).values({
    id: membershipId,
    workspaceId,
    userId,
    role: WorkspaceMembershipRole.owner,
    status: WorkspaceMembershipStatus.active,
    source,
    acceptedAt: new Date(),
    createdBy: displayLabel,
    updatedBy: displayLabel,
  });

  const formAdminsGroupId = await createGroupWithRole(tx, {
    workspaceId,
    name: FORM_ADMINS_GROUP_NAME,
    roleCodes: [Roles.form_admin],
    systemCode: SystemGroup.form_admins,
    displayLabel,
  });
  await addUserToGroup(tx, { workspaceId, groupId: formAdminsGroupId, membershipId, displayLabel });

  // People given the submit role. Who else may submit is the workspace's audience setting.
  await createGroupWithRole(tx, {
    workspaceId,
    name: FORM_SUBMITTERS_GROUP_NAME,
    roleCodes: [Roles.form_submitter],
    systemCode: SystemGroup.form_submitters,
    displayLabel,
  });
};

/**
 * Creates a user-owned team workspace: owner membership, the form-admin and form-submitter groups,
 * and every shared settings group's row, optionally recording the creator's disclaimer acceptance in
 * the same transaction.
 */
export const createTeamWorkspace = async (
  userId: string,
  name: string,
  org: string,
  useCase: string,
  disclaimerAccepted = false,
  tx?: DbOrTx,
) => {
  if (await workspaceNameExistsForKindAndOrg(WorkspaceKind.team, org, name)) {
    throw workspaceNameTaken();
  }
  const run = async (d: DbOrTx) => {
    const workspaceId = uuidv7();
    const userRow = await d
      .select({ displayLabel: appUsers.displayLabel })
      .from(appUsers)
      .where(eq(appUsers.id, userId))
      .limit(1);
    const displayLabel = userRow[0]?.displayLabel ?? null;

    await d.insert(workspaces).values({
      id: workspaceId,
      kind: WorkspaceKind.team,
      name,
      org,
      useCase,
      status: WorkspaceStatus.active,
      createdBy: displayLabel,
      updatedBy: displayLabel,
    });

    await bootstrapWorkspaceOwner(
      d,
      workspaceId,
      userId,
      displayLabel,
      WorkspaceMembershipSource.user_created,
    );

    await createWorkspaceSettings({ workspaceId, actorDisplayLabel: displayLabel }, d);

    if (disclaimerAccepted) {
      await d.insert(workspaceDisclaimerAcceptances).values({
        workspaceId,
        acceptedByUserId: userId,
        acceptedAt: new Date(),
        createdBy: displayLabel,
        updatedBy: displayLabel,
      });
    }

    return workspaceId;
  };

  // Joins the caller's transaction when given one, so the caller can commit this alongside its own
  // writes. Opens its own otherwise.
  try {
    return await (tx ? run(tx) : db.transaction(run));
  } catch (err) {
    throw nameConflictOr(err);
  }
};

/** True once the workspace's disclaimer has been accepted (gates form creation). */
export const isWorkspaceDisclaimerAccepted = async (workspaceId: string): Promise<boolean> => {
  const rows = await db
    .select({ workspaceId: workspaceDisclaimerAcceptances.workspaceId })
    .from(workspaceDisclaimerAcceptances)
    .where(eq(workspaceDisclaimerAcceptances.workspaceId, workspaceId))
    .limit(1);
  return Boolean(rows[0]);
};

const setWorkspaceDisclaimer = async (
  executor: DbOrTx,
  workspaceId: string,
  actorId: string,
  displayLabel: string | null,
  accepted: boolean,
): Promise<void> => {
  if (!accepted) {
    await executor
      .delete(workspaceDisclaimerAcceptances)
      .where(eq(workspaceDisclaimerAcceptances.workspaceId, workspaceId));
    return;
  }
  const now = new Date();
  await executor
    .insert(workspaceDisclaimerAcceptances)
    .values({
      workspaceId,
      acceptedByUserId: actorId,
      acceptedAt: now,
      createdBy: displayLabel,
      updatedBy: displayLabel,
    })
    .onConflictDoUpdate({
      target: workspaceDisclaimerAcceptances.workspaceId,
      set: { acceptedByUserId: actorId, acceptedAt: now, updatedBy: displayLabel, updatedAt: now },
    });
};

/** Updates a workspace's name and/or disclaimer acceptance; false when the actor can't manage it. */
export const updateWorkspace = async (
  workspaceId: string,
  actorId: string,
  input: { name?: string; org?: string; useCase?: string; disclaimerAccepted?: boolean },
): Promise<boolean> => {
  const membership = await getWorkspaceForUser(workspaceId, actorId);
  if (!membership || !isWorkspaceManageRole(membership.role)) return false;

  const userRow = await db
    .select({ displayLabel: appUsers.displayLabel })
    .from(appUsers)
    .where(eq(appUsers.id, actorId))
    .limit(1);
  const displayLabel = userRow[0]?.displayLabel ?? null;

  // Re-checked whenever either half of the key moves: a name edit can collide in its existing org,
  // and an org move can collide with its existing name in the org it is moving to.
  if (input.name !== undefined || input.org !== undefined) {
    const name = input.name ?? membership.name;
    const org = input.org ?? membership.org;
    if (await workspaceNameExistsForKindAndOrg(membership.kind, org, name, workspaceId)) {
      throw workspaceNameTaken();
    }
  }

  try {
    await db.transaction(async (tx) => {
      if (input.name !== undefined || input.org !== undefined || input.useCase !== undefined) {
        const updates: Record<string, unknown> = { updatedBy: displayLabel, updatedAt: new Date() };
        if (input.name !== undefined) updates.name = input.name;
        if (input.org !== undefined) updates.org = input.org;
        if (input.useCase !== undefined) updates.useCase = input.useCase;

        await tx.update(workspaces).set(updates).where(eq(workspaces.id, workspaceId));
      }
      if (input.disclaimerAccepted !== undefined) {
        await setWorkspaceDisclaimer(
          tx,
          workspaceId,
          actorId,
          displayLabel,
          input.disclaimerAccepted,
        );
      }
    });
  } catch (err) {
    throw nameConflictOr(err);
  }

  return true;
};
