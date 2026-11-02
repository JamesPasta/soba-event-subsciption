/** Builds the coverage set and returns the ids its checks look each case up by. */
import { and, asc, eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import { db } from '../../../core/db/client';
import {
  submissions,
  submissionParticipants,
  userIdentities,
  workspaceGroupMemberships,
  workspaceGroups,
} from '../../../core/db/schema';
import {
  GroupMemberKind,
  PUBLIC_PROVIDER_CODE,
  SubmissionParticipantRole,
  SubmissionParticipantStatus,
  WorkspaceGroupMembershipStatus,
  WorkspaceGroupStatus,
  WorkspaceMembershipStatus,
  type SystemGroupCode,
} from '../../../core/db/codes';
import type { SettingsSaveStatus } from '../../../core/db/repos/settingsRow';
import {
  updateFormAudience,
  updateWorkspaceAudience,
} from '../../../core/db/repos/audienceSettingRepo';
import {
  clearOverride,
  replaceOverrideMembers,
} from '../../../core/db/repos/formGroupOverrideRepo';
import { findOrCreateUserByIdentity } from '../../../core/db/repos/membershipRepo';
import {
  addUserToGroup,
  createGroupWithRole,
  getSystemGroupId,
} from '../../../core/db/repos/workspaceGroupRepo';
import { createTeamWorkspace } from '../../../core/db/repos/workspaceRepo';
import { FormService } from '../../../core/services/formService';
import { FormVersionService } from '../../../core/services/formVersionService';
import { SubmissionService } from '../../../core/services/submissionService';
import { mapInOrder } from '../../../core/inOrder';
import { addNote, changeStatus } from '../../../core/db/repos/submissionReviewRepo';
import {
  updateSubmitterSettings,
  updateWorkspaceSubmitterSettings,
} from '../../form-settings/submitter/repo';
import {
  updateReviewSettings,
  updateWorkspaceReviewSettings,
} from '../../form-settings/review/repo';
import { getFixture } from '../fixtures';
import { addMember } from '../members';
import type { ResolvedUser } from '../resolveUser';
import { recordIds } from '../runs';
import { seedSubmission } from '../seedSubmission';
import {
  ADMIN,
  ANONYMOUS,
  buildCoveragePlan,
  COVERAGE_FIXTURE_CODE,
  COVERAGE_FORM_KEYS,
  COVERAGE_SUBMISSION_KEYS,
  COVERAGE_WORKSPACE_KEYS,
  OWNER,
  PERSONA_KEYS,
  type CoverageFormKey,
  type CoverageSubmissionKey,
  type CoverageWorkspaceKey,
  type PersonaKey,
  type PlannedCoverageForm,
  type PlannedGroupOverride,
  type PlannedCoverageSubmission,
  type PlannedCoverageWorkspace,
  type PlannedSeat,
} from './plan';

const formService = new FormService();
const formVersionService = new FormVersionService();
const submissionService = new SubmissionService();

export interface CoveragePersonaRef {
  id: string;
  identityProviderCode: string;
}

export interface CoverageFormRef {
  workspaceId: string;
  formId: string;
  name: string;
}

export interface CoverageSubmissionRef {
  workspaceId: string;
  formId: string;
  submissionId: string;
}

export interface CoverageManifest {
  personas: Record<PersonaKey, CoveragePersonaRef>;
  workspaces: Record<CoverageWorkspaceKey, { id: string; name: string }>;
  forms: Record<CoverageFormKey, CoverageFormRef>;
  submissions: Record<CoverageSubmissionKey, CoverageSubmissionRef>;
}

type Persona = ResolvedUser & { identityProviderCode: string };

interface CoverageContext {
  runId: string;
  personas: Map<PersonaKey, Persona>;
  /** Membership ids by workspace, then persona. */
  memberships: Map<CoverageWorkspaceKey, Map<PersonaKey, string>>;
  /** Named group ids by workspace, then name. */
  groups: Map<CoverageWorkspaceKey, Map<string, string>>;
  forms: Map<CoverageFormKey, CoverageFormRef & { versionId: string }>;
}

const persona = (ctx: CoverageContext, key: PersonaKey): Persona => {
  const found = ctx.personas.get(key);
  if (!found) throw new Error(`Coverage persona ${key} was not created`);
  return found;
};

const actorOf = (user: ResolvedUser) => ({
  actorId: user.id,
  actorDisplayLabel: user.displayLabel,
});

const assertSaved = (status: SettingsSaveStatus, what: string): void => {
  if (status !== 'saved') throw new Error(`Coverage ${what} was not saved: ${status}`);
};

async function providerOf(userId: string): Promise<string> {
  const rows = await db
    .select({ code: userIdentities.identityProviderCode })
    .from(userIdentities)
    .where(eq(userIdentities.userId, userId))
    .orderBy(asc(userIdentities.createdAt))
    .limit(1);
  if (!rows[0]) throw new Error(`User ${userId} has no identity`);
  return rows[0].code;
}

async function createPersonas(
  runId: string,
  owner: ResolvedUser,
  publicUser: ResolvedUser,
): Promise<Map<PersonaKey, Persona>> {
  const generated = await mapInOrder(buildCoveragePlan().personas, async (planned) => {
    const id = await findOrCreateUserByIdentity(
      planned.identityProviderCode,
      planned.subject,
      planned.profile,
      planned.idpAttributes,
    );
    await recordIds(runId, { userIds: [id] });
    const created: Persona = {
      id,
      displayLabel: planned.displayLabel,
      identityProviderCode: planned.identityProviderCode,
    };
    return [planned.key, created] as const;
  });
  return new Map<PersonaKey, Persona>([
    [OWNER, { ...owner, identityProviderCode: await providerOf(owner.id) }],
    [ANONYMOUS, { ...publicUser, identityProviderCode: PUBLIC_PROVIDER_CODE }],
    ...generated,
  ]);
}

async function systemGroupId(workspaceId: string, system: SystemGroupCode): Promise<string> {
  const groupId = await getSystemGroupId(workspaceId, system);
  if (!groupId) throw new Error(`Workspace ${workspaceId} has no ${system} group`);
  return groupId;
}

async function groupFor(
  workspaceId: string,
  seat: PlannedSeat,
  admin: ResolvedUser,
  named: Map<string, string>,
): Promise<string | null> {
  if (!seat.group) return null;
  if ('system' in seat.group) return systemGroupId(workspaceId, seat.group.system);
  const existing = named.get(seat.group.name);
  if (existing) return existing;
  const groupId = await createGroupWithRole(db, {
    workspaceId,
    name: seat.group.name,
    roleCodes: [...seat.group.roleCodes],
    displayLabel: admin.displayLabel,
  });
  if (seat.group.status) {
    await db
      .update(workspaceGroups)
      .set({ status: WorkspaceGroupStatus[seat.group.status] })
      .where(eq(workspaceGroups.id, groupId));
  }
  named.set(seat.group.name, groupId);
  return groupId;
}

async function addSeat(
  ctx: CoverageContext,
  workspaceId: string,
  seat: PlannedSeat,
  named: Map<string, string>,
): Promise<string> {
  const admin = persona(ctx, ADMIN);
  const membershipId = await addMember({
    workspaceId,
    user: persona(ctx, seat.persona),
    role: seat.role,
    invitedBy: admin,
    status: seat.membershipStatus ? WorkspaceMembershipStatus[seat.membershipStatus] : undefined,
  });
  const groupId = await groupFor(workspaceId, seat, admin, named);
  if (groupId) await joinGroup({ workspaceId, groupId, membershipId, seat, admin });
  return membershipId;
}

/** Adds the membership to the group with the seat's group membership status. */
async function joinGroup(args: {
  workspaceId: string;
  groupId: string;
  membershipId: string;
  seat: PlannedSeat;
  admin: ResolvedUser;
}): Promise<void> {
  const { workspaceId, groupId, membershipId, seat } = args;
  await addUserToGroup(db, {
    workspaceId,
    groupId,
    membershipId,
    displayLabel: args.admin.displayLabel,
  });
  if (!seat.groupMembershipStatus) return;
  await db
    .update(workspaceGroupMemberships)
    .set({ status: WorkspaceGroupMembershipStatus[seat.groupMembershipStatus] })
    .where(
      and(
        eq(workspaceGroupMemberships.groupId, groupId),
        eq(workspaceGroupMemberships.workspaceMembershipId, membershipId),
      ),
    );
}

async function createForm(
  ctx: CoverageContext,
  workspace: PlannedCoverageWorkspace,
  workspaceId: string,
  planned: PlannedCoverageForm,
): Promise<void> {
  const admin = persona(ctx, ADMIN);
  const actor = actorOf(admin);
  const { form, version } = await formService.create({
    workspaceId,
    name: planned.name,
    description: planned.description,
    schema: getFixture(COVERAGE_FIXTURE_CODE).schema,
    ...actor,
  });
  if (planned.published) {
    await formVersionService.publish({ workspaceId, formVersionId: version.id, ...actor });
  }

  const formRef = { workspaceId, formId: form.id, actorDisplayLabel: admin.displayLabel };
  if (planned.audience) {
    assertSaved(await updateFormAudience({ ...formRef, audience: planned.audience }), 'audience');
  }
  if (planned.allowSubmitterDrafts !== undefined) {
    const settings = { allowSubmitterDrafts: planned.allowSubmitterDrafts };
    assertSaved(await updateSubmitterSettings({ ...formRef, settings }), 'drafts setting');
  }
  if (planned.review) {
    assertSaved(
      await updateReviewSettings({ ...formRef, settings: planned.review }),
      'review settings',
    );
  }
  if (planned.groupOverride) {
    await overrideGroup(ctx, workspace.key, workspaceId, form.id, planned.groupOverride);
  }

  ctx.forms.set(planned.key, {
    workspaceId,
    formId: form.id,
    name: planned.name,
    versionId: version.id,
  });
}

async function overrideGroup(
  ctx: CoverageContext,
  workspaceKey: CoverageWorkspaceKey,
  workspaceId: string,
  formId: string,
  override: PlannedGroupOverride,
): Promise<void> {
  const displayLabel = persona(ctx, ADMIN).displayLabel;
  const memberships = ctx.memberships.get(workspaceKey);
  const groupId =
    'system' in override.group
      ? await systemGroupId(workspaceId, override.group.system)
      : ctx.groups.get(workspaceKey)?.get(override.group.name);
  if (!groupId) throw new Error(`${workspaceKey} has no group to override on form ${formId}`);
  await replaceOverrideMembers({
    workspaceId,
    formId,
    groupId,
    members: override.members.map((key) => {
      const workspaceMembershipId = memberships?.get(key);
      if (!workspaceMembershipId) throw new Error(`${key} is not a member of ${workspaceKey}`);
      return { kind: GroupMemberKind.user, workspaceMembershipId };
    }),
    displayLabel,
  });
  if (override.cleared) await clearOverride({ formId, groupId, displayLabel });
}

async function createWorkspace(
  ctx: CoverageContext,
  planned: PlannedCoverageWorkspace,
): Promise<{ id: string; name: string }> {
  const admin = persona(ctx, ADMIN);
  // Recorded in the same transaction, so neither exists without the other.
  const workspaceId = await db.transaction(async (tx) => {
    const id = await createTeamWorkspace(
      admin.id,
      planned.name,
      planned.org,
      planned.useCase,
      planned.disclaimerAccepted,
      tx,
    );
    await recordIds(ctx.runId, { workspaceIds: [id] }, tx);
    return id;
  });

  const settingsRef = { workspaceId, actorDisplayLabel: admin.displayLabel };
  assertSaved(
    await updateWorkspaceAudience({ ...settingsRef, audience: planned.audience }),
    'workspace audience',
  );
  assertSaved(
    await updateWorkspaceSubmitterSettings({
      ...settingsRef,
      settings: { allowSubmitterDrafts: planned.allowSubmitterDrafts },
    }),
    'workspace drafts setting',
  );
  assertSaved(
    await updateWorkspaceReviewSettings({ ...settingsRef, settings: planned.review }),
    'workspace review settings',
  );

  const named = new Map<string, string>();
  ctx.groups.set(planned.key, named);
  const seats = await mapInOrder(
    planned.seats,
    async (seat) => [seat.persona, await addSeat(ctx, workspaceId, seat, named)] as const,
  );
  ctx.memberships.set(planned.key, new Map<PersonaKey, string>(seats));

  await mapInOrder(planned.forms, (form) => createForm(ctx, planned, workspaceId, form));
  return { id: workspaceId, name: planned.name };
}

async function createSubmission(
  ctx: CoverageContext,
  planned: PlannedCoverageSubmission,
  index: number,
): Promise<CoverageSubmissionRef> {
  const form = ctx.forms.get(planned.form);
  if (!form) throw new Error(`Coverage form ${planned.form} was not created`);
  const by = persona(ctx, planned.by);
  const actor = actorOf(by);
  const { workspaceId, formId } = form;
  const submissionId = await seedSubmission({
    workspaceId,
    formId,
    ...actor,
    data: getFixture(COVERAGE_FIXTURE_CODE).answers(index),
    events: planned.events,
  });

  const grants = planned.collaborators ?? [];
  if (grants.length > 0) {
    await db.insert(submissionParticipants).values(
      grants.map((grant) => {
        const inactive = grant.status === 'inactive';
        return {
          workspaceId,
          submissionId,
          userId: persona(ctx, grant.persona).id,
          role: SubmissionParticipantRole.collaborator,
          status: SubmissionParticipantStatus[grant.status],
          grantedBy: by.id,
          revokedBy: inactive ? by.id : null,
          revokedAt: inactive ? new Date() : null,
          createdBy: by.displayLabel,
          updatedBy: by.displayLabel,
        };
      }),
    );
  }

  // In order, so the notes keep the plan's oldest-first order.
  await mapInOrder(planned.notes ?? [], async (note) => {
    const author = persona(ctx, note.by);
    const outcome = await addNote({
      id: uuidv7(),
      workspaceId,
      submissionId,
      text: note.text,
      actorId: author.id,
      actorDisplayLabel: author.displayLabel,
    });
    if (outcome !== 'added') throw new Error(`Note on ${planned.key} was not added: ${outcome}`);
  });

  // In order, as each change is made from the status before it.
  await mapInOrder(planned.statusChanges ?? [], async (change) => {
    const changer = persona(ctx, change.by);
    const [head] = await db
      .select({ statusId: submissions.statusId })
      .from(submissions)
      .where(eq(submissions.id, submissionId));
    if (!head?.statusId) throw new Error(`${planned.key} has no status to change`);
    const outcome = await changeStatus({
      id: uuidv7(),
      workspaceId,
      submissionId,
      fromStatusId: head.statusId,
      status: change.status,
      assigneeId: change.assignee ? persona(ctx, change.assignee).id : null,
      actorId: changer.id,
      actorDisplayLabel: changer.displayLabel,
    });
    if (outcome !== 'changed') {
      throw new Error(`Status of ${planned.key} was not changed: ${outcome}`);
    }
  });

  if (planned.deleted) {
    await submissionService.deleteUnsubmitted({ workspaceId, submissionId, ...actor });
  }
  return { workspaceId, formId, submissionId };
}

/** Every key's entry, mapped; a missing key means the build skipped a case. */
function recordOf<K extends string, V, R>(
  keys: readonly K[],
  built: Map<K, V>,
  map: (value: V) => R,
): Record<K, R> {
  return Object.fromEntries(
    keys.map((key) => {
      const value = built.get(key);
      if (value === undefined) throw new Error(`Coverage case ${key} was not built`);
      return [key, map(value)];
    }),
  ) as Record<K, R>;
}

/** Form and version deletes, and versions published over the old, once the submissions exist. */
async function applyChanges(
  ctx: CoverageContext,
  plannedForms: PlannedCoverageForm[],
): Promise<void> {
  const actor = actorOf(persona(ctx, ADMIN));
  await mapInOrder(
    plannedForms.filter((planned) => planned.afterSubmissions),
    async (planned) => {
      const form = ctx.forms.get(planned.key);
      if (!form) throw new Error(`Coverage form ${planned.key} was not created`);
      const { workspaceId, formId, versionId } = form;
      switch (planned.afterSubmissions) {
        case 'deleteForm':
          await formService.delete({ workspaceId, formId, ...actor });
          break;
        case 'deleteVersion':
          await formVersionService.delete({ workspaceId, formVersionId: versionId, ...actor });
          break;
        case 'publishNewVersion': {
          const { version } = await formVersionService.createDraft({
            workspaceId,
            formId,
            fromFormVersionId: versionId,
            ...actor,
          });
          await formVersionService.publish({ workspaceId, formVersionId: version.id, ...actor });
          break;
        }
      }
    },
  );
}

/**
 * Personas, three workspaces owned by the admin persona, their forms and submissions. Every row
 * sits in a recorded workspace or is a recorded user, so purge needs nothing more.
 */
export async function generateCoverage(args: {
  runId: string;
  owner: ResolvedUser;
  publicUser: ResolvedUser;
}): Promise<CoverageManifest> {
  const plan = buildCoveragePlan();
  const ctx: CoverageContext = {
    runId: args.runId,
    personas: await createPersonas(args.runId, args.owner, args.publicUser),
    memberships: new Map(),
    groups: new Map(),
    forms: new Map(),
  };

  const workspaces = await mapInOrder(
    plan.workspaces,
    async (planned) => [planned.key, await createWorkspace(ctx, planned)] as const,
  );
  const submissions = await mapInOrder(
    plan.submissions,
    async (planned, index) => [planned.key, await createSubmission(ctx, planned, index)] as const,
  );
  await applyChanges(
    ctx,
    plan.workspaces.flatMap((w) => w.forms),
  );

  return {
    personas: recordOf(PERSONA_KEYS, ctx.personas, ({ id, identityProviderCode }) => ({
      id,
      identityProviderCode,
    })),
    workspaces: recordOf(COVERAGE_WORKSPACE_KEYS, new Map(workspaces), (ref) => ref),
    forms: recordOf(COVERAGE_FORM_KEYS, ctx.forms, ({ workspaceId, formId, name }) => ({
      workspaceId,
      formId,
      name,
    })),
    submissions: recordOf(COVERAGE_SUBMISSION_KEYS, new Map(submissions), (ref) => ref),
  };
}
