/**
 * Runs the plan through the real services, so forms and submissions exist in Postgres and in the
 * form engine. No argv, console, or process exit: takes options, returns a manifest.
 */
import { db } from '../../core/db/client';
import type { WorkspaceMembershipRoleCode } from '../../core/db/codes';
import { ConflictError } from '../../core/errors';
import { mapInOrder } from '../../core/inOrder';
import { createTeamWorkspace } from '../../core/db/repos/workspaceRepo';
import { findOrCreateUserByIdentity } from '../../core/db/repos/membershipRepo';
import { addUserToGroup, createGroupWithRole } from '../../core/db/repos/workspaceGroupRepo';
import { updateWorkspaceAudience } from '../../core/db/repos/audienceSettingRepo';
import { FormService } from '../../core/services/formService';
import { FormVersionService } from '../../core/services/formVersionService';

import { generateCoverage, type CoverageManifest } from './access/generate';
import { getFixture, type DevFormFixture } from './fixtures';
import { addMember } from './members';
import {
  buildPlan,
  DEFAULT_SIZE,
  type PlannedForm,
  type PlannedSubmission,
  type PlannedAudience,
  type PlannedSubmitter,
  type PlannedWorkspace,
  type PlannedUser,
  type SizeName,
} from './plan';
import { requireBaseSeed } from './preconditions';
import { finishRun, hasOpenRun, recordIds, startRun } from './runs';
import { resolveTargetUser, type ResolvedUser, type UserRef } from './resolveUser';
import { seedSubmission } from './seedSubmission';

// Not from the core container, which also wires the API service layer this tool does not use.
const formService = new FormService();
const formVersionService = new FormVersionService();

export interface GenerateOptions {
  /** The real user the data is built around. */
  user: UserRef;
  /** Rows in the biggest collections. Defaults to 'large'. */
  size?: SizeName;
  /** Attribute some submissions to the seeded public user. */
  includeAnonymousSubmissions?: boolean;
}

export interface ManifestForm {
  id: string;
  name: string;
  published: boolean;
  submissionIds: string[];
}

export interface ManifestWorkspace {
  id: string;
  name: string;
  /** Role the target user holds, or null when they are not a member. */
  targetUserRole: WorkspaceMembershipRoleCode | null;
  disclaimerAccepted: boolean;
  audience: PlannedAudience;
  memberCount: number;
  forms: ManifestForm[];
}

export interface DevDataManifest {
  generatedAt: string;
  size: SizeName;
  owner: ResolvedUser;
  anchors: {
    pagingForms: string | null;
    pagingMembers: string | null;
    pagingSubmissions: { workspaceId: string; formId: string } | null;
  };
  users: Array<{ id: string; displayLabel: string; identityProviderCode: string }>;
  workspaces: ManifestWorkspace[];
  counts: Record<string, number>;
  coverage: CoverageManifest;
}

interface GenerateContext {
  runId: string;
  target: ResolvedUser;
  /** Dev users keyed by plan index. */
  users: Map<number, ResolvedUser>;
  publicUser: ResolvedUser;
  includeAnonymous: boolean;
}

/** A second set would collide on the unique names. An unfinished run counts as present. */
async function assertNoExistingDevData(): Promise<void> {
  if (await hasOpenRun()) {
    throw new ConflictError('Dev data is already present; purge it before generating again');
  }
}

async function createUsers(
  plannedUsers: PlannedUser[],
  runId: string,
): Promise<Map<number, ResolvedUser>> {
  const users = new Map<number, ResolvedUser>();
  // Recorded one at a time: a failure part way through must not orphan the ones already made.
  await mapInOrder(plannedUsers, async (planned) => {
    const { identityProviderCode, subject, profile } = planned;
    const id = await findOrCreateUserByIdentity(identityProviderCode, subject, profile);
    await recordIds(runId, { userIds: [id] });
    users.set(planned.index, { id, displayLabel: planned.displayLabel });
  });
  return users;
}

function requireUser(ctx: GenerateContext, index: number): ResolvedUser {
  const user = ctx.users.get(index);
  if (!user) throw new Error(`Dev user ${index} was not created`);
  return user;
}

const ownerOf = (ctx: GenerateContext, planned: PlannedWorkspace): ResolvedUser =>
  planned.ownerUserIndex == null ? ctx.target : requireUser(ctx, planned.ownerUserIndex);

/** Memberships for the target user when they are not the owner, plus every planned dev member. */
async function addMembers(
  ctx: GenerateContext,
  workspaceId: string,
  planned: PlannedWorkspace,
  owner: ResolvedUser,
): Promise<{ dev: Map<number, string>; target: string | null }> {
  const dev = new Map<number, string>();
  let target: string | null = null;

  if (planned.ownerUserIndex != null && planned.targetUserRole) {
    target = await addMember({
      workspaceId,
      user: ctx.target,
      role: planned.targetUserRole,
      invitedBy: owner,
    });
  }

  // In plan order, so the time-ordered ids follow the plan.
  await mapInOrder(planned.members, async (member) => {
    const user = requireUser(ctx, member.userIndex);
    const membershipId = await addMember({
      workspaceId,
      user,
      role: member.role,
      invitedBy: owner,
    });
    dev.set(member.userIndex, membershipId);
  });
  return { dev, target };
}

/** A new workspace is already 'protected', so only the other modes need work. */
async function applyAudience(
  workspaceId: string,
  planned: PlannedWorkspace,
  owner: ResolvedUser,
): Promise<void> {
  if (planned.audience === 'protected') return;
  await updateWorkspaceAudience({
    workspaceId,
    audience: { mode: planned.audience, idps: [] },
    actorDisplayLabel: owner.displayLabel,
  });
}

/** One transaction per workspace: a group and its members belong together. */
async function createGroups(
  workspaceId: string,
  planned: PlannedWorkspace,
  memberships: { dev: Map<number, string>; target: string | null },
  owner: ResolvedUser,
): Promise<void> {
  const displayLabel = owner.displayLabel;

  // A transaction runs its statements one at a time on one connection.
  await db.transaction(async (tx) => {
    await mapInOrder(planned.groups, async (group) => {
      const groupId = await createGroupWithRole(tx, {
        workspaceId,
        name: group.name,
        roleCodes: [...group.roleCodes],
        displayLabel,
      });
      await mapInOrder(group.memberUserIndexes, async (userIndex) => {
        const membershipId = memberships.dev.get(userIndex);
        if (!membershipId) throw new Error(`No membership for dev user ${userIndex}`);
        await addUserToGroup(tx, { workspaceId, groupId, membershipId, displayLabel });
      });
    });

    // Without this the target user's workspace role grants no form access at all.
    if (planned.targetGroup && memberships.target) {
      const groupId = await createGroupWithRole(tx, {
        workspaceId,
        name: planned.targetGroup.name,
        roleCodes: [...planned.targetGroup.roleCodes],
        displayLabel,
      });
      await addUserToGroup(tx, {
        workspaceId,
        groupId,
        membershipId: memberships.target,
        displayLabel,
      });
    }
  });
}

/** With anonymous off the row is still created, attributed to the target: the planned counts are
 *  what the paging anchors depend on. */
function submitterOf(ctx: GenerateContext, submitter: PlannedSubmitter): ResolvedUser {
  if (submitter.kind === 'target') return ctx.target;
  if (submitter.kind === 'devUser') return requireUser(ctx, submitter.userIndex);
  return ctx.includeAnonymous ? ctx.publicUser : ctx.target;
}

async function createSubmission(args: {
  ctx: GenerateContext;
  workspaceId: string;
  formId: string;
  fixture: DevFormFixture;
  planned: PlannedSubmission;
}): Promise<string> {
  const actor = submitterOf(args.ctx, args.planned.submitter);
  return seedSubmission({
    workspaceId: args.workspaceId,
    formId: args.formId,
    actorId: actor.id,
    actorDisplayLabel: actor.displayLabel,
    data: args.fixture.answers(args.planned.index),
    events: args.planned.events,
  });
}

async function createForm(
  ctx: GenerateContext,
  workspaceId: string,
  planned: PlannedForm,
  owner: ResolvedUser,
): Promise<ManifestForm> {
  const actor = { actorId: owner.id, actorDisplayLabel: owner.displayLabel };
  const fixture = getFixture(planned.fixtureCode);

  const { form, version } = await formService.create({
    workspaceId,
    name: planned.name,
    description: planned.description,
    schema: fixture.schema,
    ...actor,
  });

  if (planned.published) {
    await formVersionService.publish({ workspaceId, formVersionId: version.id, ...actor });
  }

  // In plan order, so the time-ordered ids follow the plan.
  const submissionIds = await mapInOrder(planned.submissions, (submission) =>
    createSubmission({ ctx, workspaceId, formId: form.id, fixture, planned: submission }),
  );

  return { id: form.id, name: planned.name, published: planned.published, submissionIds };
}

async function createWorkspace(
  ctx: GenerateContext,
  planned: PlannedWorkspace,
): Promise<ManifestWorkspace> {
  const owner = ownerOf(ctx, planned);
  // One transaction: an unrecorded workspace would block every later seed on its deterministic
  // name, with no way for purge to reach it. Committing the row and its record together means
  // neither can exist without the other.
  const workspaceId = await db.transaction(async (tx) => {
    const id = await createTeamWorkspace(
      owner.id,
      planned.name,
      planned.org,
      planned.useCase,
      planned.disclaimerAccepted,
      tx,
    );
    await recordIds(ctx.runId, { workspaceIds: [id] }, tx);
    return id;
  });

  const memberships = await addMembers(ctx, workspaceId, planned, owner);
  await applyAudience(workspaceId, planned, owner);
  await createGroups(workspaceId, planned, memberships, owner);

  // In plan order, so the time-ordered ids follow the plan.
  const forms = await mapInOrder(planned.forms, (plannedForm) =>
    createForm(ctx, workspaceId, plannedForm, owner),
  );

  return {
    id: workspaceId,
    name: planned.name,
    targetUserRole: planned.targetUserRole,
    disclaimerAccepted: planned.disclaimerAccepted,
    audience: planned.audience,
    // Planned dev members, plus the target user's row, plus the owner's own row.
    memberCount:
      planned.members.length +
      (planned.targetUserRole ? 1 : 0) +
      (planned.ownerUserIndex != null ? 1 : 0),
    forms,
  };
}

function buildAnchors(
  plan: ReturnType<typeof buildPlan>,
  created: ManifestWorkspace[],
): DevDataManifest['anchors'] {
  const idFor = (anchor: string): ManifestWorkspace | null => {
    const index = plan.workspaces.findIndex((w) => w.anchor === anchor);
    return index === -1 ? null : (created[index] ?? null);
  };
  const submissions = idFor('pagingSubmissions');
  return {
    pagingForms: idFor('pagingForms')?.id ?? null,
    pagingMembers: idFor('pagingMembers')?.id ?? null,
    pagingSubmissions: submissions?.forms[0]
      ? { workspaceId: submissions.id, formId: submissions.forms[0].id }
      : null,
  };
}

function countRows(workspaces: ManifestWorkspace[], userCount: number): Record<string, number> {
  const forms = workspaces.flatMap((w) => w.forms);
  return {
    users: userCount,
    workspaces: workspaces.length,
    forms: forms.length,
    publishedForms: forms.filter((f) => f.published).length,
    submissions: forms.reduce((total, f) => total + f.submissionIds.length, 0),
  };
}

/** Build the data set. Fails if one is already present. */
export async function generate(options: GenerateOptions): Promise<DevDataManifest> {
  // Environment, then caller input, then state. Out of order these report the wrong problem.
  const publicUser = await requireBaseSeed();
  const target = await resolveTargetUser(options.user);
  await assertNoExistingDevData();

  const size = options.size ?? DEFAULT_SIZE;
  const plan = buildPlan(size);
  // Recorded before anything is written, so a run that dies part-way is still visible.
  const runId = await startRun({ size, ownerUserId: target.id, stampedBy: target.displayLabel });

  // First, so its rows take the lowest ids and trail the default id:desc lists.
  const coverage = await generateCoverage({ runId, owner: target, publicUser });

  const ctx: GenerateContext = {
    runId,
    target,
    users: await createUsers(plan.users, runId),
    publicUser,
    includeAnonymous: options.includeAnonymousSubmissions ?? true,
  };

  // Created newest-first so the anchors, which the plan puts at indices 0-2, get the highest ids
  // and lead the default id:desc list instead of trailing it. Written back by plan index, so the
  // manifest still lines up with the plan.
  const created: ManifestWorkspace[] = new Array(plan.workspaces.length);
  await mapInOrder([...plan.workspaces].reverse(), async (planned) => {
    created[planned.index] = await createWorkspace(ctx, planned);
  });

  const manifest: DevDataManifest = {
    generatedAt: new Date().toISOString(),
    size,
    owner: target,
    anchors: buildAnchors(plan, created),
    users: plan.users.map((u) => ({
      id: requireUser(ctx, u.index).id,
      displayLabel: u.displayLabel,
      identityProviderCode: u.identityProviderCode,
    })),
    workspaces: created,
    counts: countRows(created, ctx.users.size),
    coverage,
  };

  await finishRun(runId, manifest, target.displayLabel);
  return manifest;
}
