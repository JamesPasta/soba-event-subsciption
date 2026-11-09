import { and, asc, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  canChangeReviewStatus,
  SUBMISSION_STATUS_MOVES,
  SubmissionReviewStatuses,
  type SubmissionEdit,
  type SubmissionNote,
  type SubmissionReviewStatus,
  type SubmissionReviewUser,
  type SubmissionStatusChange,
} from '@soba/lib';
import { db, type DbOrTx, type Tx } from '../client';
import {
  AppUserStatus,
  RevisionStatus,
  SubmissionEventType,
  SubmissionParticipantStatus,
  SubmissionWorkflowState,
} from '../codes';
import {
  appUsers,
  forms,
  submissionNotes,
  submissionParticipants,
  submissionRevisions,
  submissionStatuses,
  submissions,
} from '../schema';
import { profileHelpers, type StoredProfile } from '../../auth/jwtClaims';
import { restoreLastSettled } from './submissionRevisionChain';

/** How a person on a review record is named: their profile's name, else their stamp label. */
const nameOf = (profile: unknown, label: string | null): string =>
  profileHelpers.getDisplayName(profile as StoredProfile | null) ?? label ?? '';

/** A person on a review record, named as nameOf names them, with their email when known. */
export const reviewUserOf = (
  id: string,
  profile: unknown,
  label: string | null,
): SubmissionReviewUser => ({
  id,
  displayName: nameOf(profile, label),
  email: profileHelpers.getEmail(profile as StoredProfile | null),
});

const assignees = alias(appUsers, 'assignee');

/** A submission's status changes, newest first. Empty until it is first submitted. */
export const listStatusHistory = async (
  workspaceId: string,
  submissionId: string,
): Promise<SubmissionStatusChange[]> => {
  const rows = await db
    .select({
      id: submissionStatuses.id,
      status: submissionStatuses.status,
      changedAt: submissionStatuses.createdAt,
      changedByLabel: submissionStatuses.changedByLabel,
      changerProfile: appUsers.profile,
      changerLabel: appUsers.displayLabel,
      assigneeId: assignees.id,
      assigneeProfile: assignees.profile,
      assigneeLabel: assignees.displayLabel,
    })
    .from(submissionStatuses)
    .leftJoin(appUsers, eq(appUsers.id, submissionStatuses.changedBy))
    .leftJoin(assignees, eq(assignees.id, submissionStatuses.assigneeId))
    .where(
      and(
        eq(submissionStatuses.workspaceId, workspaceId),
        eq(submissionStatuses.submissionId, submissionId),
      ),
    )
    .orderBy(desc(submissionStatuses.createdAt), desc(submissionStatuses.id));

  return rows.map((row) => ({
    id: row.id,
    status: row.status as SubmissionReviewStatus,
    assignee: row.assigneeId
      ? reviewUserOf(row.assigneeId, row.assigneeProfile, row.assigneeLabel)
      : null,
    changedAt: row.changedAt.toISOString(),
    updatedBy: nameOf(row.changerProfile, row.changedByLabel ?? row.changerLabel),
  }));
};

/** A submission's notes, newest first. */
export const listNotes = async (
  workspaceId: string,
  submissionId: string,
): Promise<SubmissionNote[]> => {
  const rows = await db
    .select({
      id: submissionNotes.id,
      text: submissionNotes.text,
      createdAt: submissionNotes.createdAt,
      createdByLabel: submissionNotes.createdByLabel,
      authorProfile: appUsers.profile,
      authorLabel: appUsers.displayLabel,
    })
    .from(submissionNotes)
    .leftJoin(appUsers, eq(appUsers.id, submissionNotes.createdBy))
    .where(
      and(
        eq(submissionNotes.workspaceId, workspaceId),
        eq(submissionNotes.submissionId, submissionId),
      ),
    )
    .orderBy(desc(submissionNotes.createdAt), desc(submissionNotes.id));

  return rows.map((row) => ({
    id: row.id,
    text: row.text,
    createdAt: row.createdAt.toISOString(),
    createdBy: nameOf(row.authorProfile, row.createdByLabel ?? row.authorLabel),
  }));
};

/**
 * Changes to the answers after the submission was first submitted, newest first: every accepted
 * revision after the first submit, except its deletion. Pending revisions were never applied.
 */
export const listEdits = async (
  workspaceId: string,
  submissionId: string,
): Promise<SubmissionEdit[]> => {
  const rows = await db
    .select({
      id: submissionRevisions.id,
      revisionNo: submissionRevisions.revisionNo,
      eventType: submissionRevisions.eventType,
      createdAt: submissionRevisions.createdAt,
      editorProfile: appUsers.profile,
      editorLabel: appUsers.displayLabel,
    })
    .from(submissionRevisions)
    .leftJoin(appUsers, eq(appUsers.id, submissionRevisions.changedBy))
    .where(
      and(
        eq(submissionRevisions.workspaceId, workspaceId),
        eq(submissionRevisions.submissionId, submissionId),
        ne(submissionRevisions.status, RevisionStatus.pending),
      ),
    )
    .orderBy(asc(submissionRevisions.revisionNo));

  const firstSubmit = rows.find((row) => row.eventType === SubmissionEventType.submitted);
  if (!firstSubmit) return [];
  return rows
    .filter(
      (row) =>
        row.revisionNo > firstSubmit.revisionNo && row.eventType !== SubmissionEventType.deleted,
    )
    .reverse()
    .map((row) => ({
      id: row.id,
      editedAt: row.createdAt.toISOString(),
      editedBy: nameOf(row.editorProfile, row.editorLabel),
    }));
};

/** The status a submission's head points at; null before it is first submitted. */
const headStatusOf = async (
  tx: DbOrTx,
  statusId: string | null,
): Promise<{ status: SubmissionReviewStatus; createdAt: Date } | null> => {
  if (!statusId) return null;
  const [head] = await tx
    .select({ status: submissionStatuses.status, createdAt: submissionStatuses.createdAt })
    .from(submissionStatuses)
    .where(eq(submissionStatuses.id, statusId))
    .limit(1);
  return head ? { status: head.status as SubmissionReviewStatus, createdAt: head.createdAt } : null;
};

/**
 * Starts a submission's review as Submitted, inside the transaction that records its submit. A
 * resubmit after a revision request is Submitted again; any other status is kept.
 */
export const recordSubmittedStatus = async (
  tx: Tx,
  input: {
    workspaceId: string;
    submissionId: string;
    actorId: string;
    actorDisplayLabel: string | null;
  },
): Promise<void> => {
  const [submission] = await tx
    .select({ statusId: submissions.statusId })
    .from(submissions)
    .where(
      and(eq(submissions.id, input.submissionId), eq(submissions.workspaceId, input.workspaceId)),
    )
    .limit(1);
  if (!submission) return;
  const head = await headStatusOf(tx, submission.statusId);
  if (head && head.status !== SubmissionReviewStatuses.revising) return;

  const [status] = await tx
    .insert(submissionStatuses)
    .values({
      workspaceId: input.workspaceId,
      submissionId: input.submissionId,
      status: SubmissionReviewStatuses.submitted,
      changedBy: input.actorId,
      changedByLabel: input.actorDisplayLabel,
    })
    .returning({ id: submissionStatuses.id });
  await tx
    .update(submissions)
    .set({ statusId: status.id })
    .where(eq(submissions.id, input.submissionId));
};

/**
 * added    - the note is new.
 * replayed - a retry of a note already added: same id, submission, author and text.
 * taken    - the id is already used for a different note.
 * missing  - the submission is not live in the workspace.
 */
export type AddNoteOutcome = 'added' | 'replayed' | 'taken' | 'missing';

/** Adds a staff note under the id the client chose, once. */
export const addNote = async (
  input: {
    id: string;
    workspaceId: string;
    submissionId: string;
    text: string;
    actorId: string;
    actorDisplayLabel: string | null;
  },
  executor: DbOrTx = db,
): Promise<AddNoteOutcome> => {
  const [live] = await executor
    .select({ id: submissions.id })
    .from(submissions)
    .where(
      and(
        eq(submissions.id, input.submissionId),
        eq(submissions.workspaceId, input.workspaceId),
        isNull(submissions.deletedAt),
      ),
    )
    .limit(1);
  if (!live) return 'missing';

  const inserted = await executor
    .insert(submissionNotes)
    .values({
      id: input.id,
      workspaceId: input.workspaceId,
      submissionId: input.submissionId,
      text: input.text,
      createdBy: input.actorId,
      createdByLabel: input.actorDisplayLabel,
    })
    .onConflictDoNothing({ target: submissionNotes.id })
    .returning({ id: submissionNotes.id });
  if (inserted.length > 0) return 'added';

  const [existing] = await executor
    .select({
      submissionId: submissionNotes.submissionId,
      text: submissionNotes.text,
      createdBy: submissionNotes.createdBy,
    })
    .from(submissionNotes)
    .where(eq(submissionNotes.id, input.id))
    .limit(1);
  const sameNote =
    existing?.submissionId === input.submissionId &&
    existing.text === input.text &&
    existing.createdBy === input.actorId;
  return sameNote ? 'replayed' : 'taken';
};

/** What a status email names, and who a submitter-facing one goes to. */
export interface StatusEmailFacts {
  formId: string;
  formName: string;
  confirmationCode: string;
  /** The emails of its owner and active collaborators, once each, leaving out the actor. */
  submitterEmails: string[];
}

const emailsOf = (rows: Array<{ profile: unknown }>): string[] => [
  ...new Set(
    rows.flatMap((row) => profileHelpers.getEmail(row.profile as StoredProfile | null) ?? []),
  ),
];

/**
 * The facts a submission's status email needs; null when it is not live in the workspace. The actor
 * made the change, so they are not among the submitters it goes to.
 */
export const findStatusEmailFacts = async (
  workspaceId: string,
  submissionId: string,
  actorId: string | null,
): Promise<StatusEmailFacts | null> => {
  const [row] = await db
    .select({
      formId: submissions.formId,
      formName: forms.name,
      confirmationCode: submissions.confirmationCode,
    })
    .from(submissions)
    .innerJoin(forms, eq(forms.id, submissions.formId))
    .where(
      and(
        eq(submissions.id, submissionId),
        eq(submissions.workspaceId, workspaceId),
        isNull(submissions.deletedAt),
      ),
    )
    .limit(1);
  if (!row) return null;
  const submitters = await db
    .select({ profile: appUsers.profile })
    .from(submissionParticipants)
    .innerJoin(appUsers, eq(appUsers.id, submissionParticipants.userId))
    .where(
      and(
        eq(submissionParticipants.submissionId, submissionId),
        eq(submissionParticipants.status, SubmissionParticipantStatus.active),
        actorId === null ? undefined : ne(submissionParticipants.userId, actorId),
      ),
    );
  return { ...row, formName: row.formName ?? '', submitterEmails: emailsOf(submitters) };
};

/** True when the user is one of the submission's active submitters: its owner or a collaborator. */
export const isActiveSubmitter = async (
  executor: DbOrTx,
  submissionId: string,
  userId: string,
): Promise<boolean> => {
  const [row] = await executor
    .select({ id: submissionParticipants.id })
    .from(submissionParticipants)
    .where(
      and(
        eq(submissionParticipants.submissionId, submissionId),
        eq(submissionParticipants.userId, userId),
        eq(submissionParticipants.status, SubmissionParticipantStatus.active),
      ),
    )
    .limit(1);
  return row !== undefined;
};

/** A status change as its email needs it. */
export interface StatusChangeForEmail {
  workspaceId: string;
  submissionId: string;
  status: SubmissionReviewStatus;
  assigneeId: string | null;
  /** Who made the change; null for a user since removed. */
  changedBy: string | null;
  /** The change is still the submission's status, and the submission is live. */
  current: boolean;
  /** The comment saved with the change, if any; whether it goes in the email is the job's choice. */
  comment: string | null;
}

/** The status change `id` and its comment; null when there is none. */
export const findStatusChangeForEmail = async (
  id: string,
): Promise<StatusChangeForEmail | null> => {
  const [row] = await db
    .select({
      workspaceId: submissionStatuses.workspaceId,
      submissionId: submissionStatuses.submissionId,
      status: submissionStatuses.status,
      assigneeId: submissionStatuses.assigneeId,
      changedBy: submissionStatuses.changedBy,
      currentStatusId: submissions.statusId,
      deletedAt: submissions.deletedAt,
      comment: submissionNotes.text,
    })
    .from(submissionStatuses)
    .innerJoin(submissions, eq(submissions.id, submissionStatuses.submissionId))
    .leftJoin(submissionNotes, eq(submissionNotes.id, submissionStatuses.id))
    .where(eq(submissionStatuses.id, id))
    .limit(1);
  if (!row) return null;
  return {
    workspaceId: row.workspaceId,
    submissionId: row.submissionId,
    status: row.status as SubmissionReviewStatus,
    assigneeId: row.assigneeId,
    changedBy: row.changedBy,
    current: row.currentStatusId === id && row.deletedAt === null,
    comment: row.comment,
  };
};

/** A user's email from their profile; null when none is known. */
export const findUserEmail = async (userId: string): Promise<string | null> => {
  const rows = await db
    .select({ profile: appUsers.profile })
    .from(appUsers)
    .where(eq(appUsers.id, userId))
    .limit(1);
  return emailsOf(rows)[0] ?? null;
};

/** The active users among `userIds`, as review records name them, by name. */
export const listReviewUsers = async (userIds: string[]): Promise<SubmissionReviewUser[]> => {
  if (userIds.length === 0) return [];
  const rows = await db
    .select({ id: appUsers.id, profile: appUsers.profile, label: appUsers.displayLabel })
    .from(appUsers)
    .where(and(inArray(appUsers.id, userIds), eq(appUsers.status, AppUserStatus.active)));
  return rows
    .map((row) => reviewUserOf(row.id, row.profile, row.label))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
};

/**
 * changed     - the status changed.
 * replayed    - a retry of a change already made: same id, submission, status, assignee and author.
 * taken       - the id is already used for a different change.
 * stale       - the status moved on since the reviewer saw it.
 * updates_off - the form's review settings turn status changes off, and this is not ending a
 *               revision.
 * not_allowed - the move is not allowed from the current status.
 * missing     - the submission is not live in the workspace, or has no status yet.
 */
export type ChangeStatusOutcome =
  | 'changed'
  | 'replayed'
  | 'taken'
  | 'stale'
  | 'updates_off'
  | 'not_allowed'
  | 'missing';

/**
 * The workflow state a review move puts a submission in: Revising sends it back to its submitters,
 * and moving on from Revising submits it again. Undefined when the move leaves it alone.
 */
const workflowStateAfter = (
  from: SubmissionReviewStatus | undefined,
  to: SubmissionReviewStatus,
):
  | typeof SubmissionWorkflowState.revising
  | typeof SubmissionWorkflowState.submitted
  | undefined => {
  if (to === SubmissionReviewStatuses.revising) return SubmissionWorkflowState.revising;
  if (from === SubmissionReviewStatuses.revising) return SubmissionWorkflowState.submitted;
  return undefined;
};

/** When the submission's current revision request was made; null when it is not revising. */
export const findRevisionStartedAt = async (
  workspaceId: string,
  submissionId: string,
): Promise<Date | null> => {
  const [submission] = await db
    .select({ statusId: submissions.statusId, workflowState: submissions.workflowState })
    .from(submissions)
    .where(and(eq(submissions.id, submissionId), eq(submissions.workspaceId, workspaceId)))
    .limit(1);
  if (submission?.workflowState !== SubmissionWorkflowState.revising) return null;
  const head = await headStatusOf(db, submission.statusId);
  return head?.status === SubmissionReviewStatuses.revising ? head.createdAt : null;
};

/**
 * Moves a submission to a new status under the id the client chose, once, and only from the status
 * the reviewer saw. The submission row is locked, so two changes to it, and a submitter's save, run
 * one after the other.
 *
 * Moving to Revising opens the submission to its submitters again. Moving on from Revising ends the
 * revision: the last settled answers become current again and the submission is submitted, so
 * whatever the submitters saved while revising is kept in the history but no longer shown.
 */
export const changeStatus = (input: {
  id: string;
  workspaceId: string;
  submissionId: string;
  fromStatusId: string;
  status: SubmissionReviewStatus;
  assigneeId: string | null;
  actorId: string;
  actorDisplayLabel: string | null;
  /** The form's review setting; a submitter's own revise and dev data are not bound by it. */
  allowStatusUpdates?: boolean;
  /** Narrows the move to one from this status, as a submitter's own revise is. */
  onlyFrom?: SubmissionReviewStatus;
  /** A comment saved with the change as a staff note, under the change's id. */
  comment?: string;
  /**
   * Runs in the change's transaction once the change is made, to queue what it sets off. A replay
   * or a refused change never runs it.
   */
  onChanged?: (tx: Tx) => Promise<void>;
}): Promise<ChangeStatusOutcome> =>
  db.transaction(async (tx) => {
    const [submission] = await tx
      .select({
        statusId: submissions.statusId,
        headRevisionId: submissions.headRevisionId,
        engineSubmissionRef: submissions.engineSubmissionRef,
      })
      .from(submissions)
      .where(
        and(
          eq(submissions.id, input.submissionId),
          eq(submissions.workspaceId, input.workspaceId),
          isNull(submissions.deletedAt),
        ),
      )
      .limit(1)
      .for('no key update');
    if (!submission?.statusId) return 'missing';

    const [existing] = await tx
      .select({
        submissionId: submissionStatuses.submissionId,
        status: submissionStatuses.status,
        assigneeId: submissionStatuses.assigneeId,
        changedBy: submissionStatuses.changedBy,
      })
      .from(submissionStatuses)
      .where(eq(submissionStatuses.id, input.id))
      .limit(1);
    if (existing) {
      const sameChange =
        existing.submissionId === input.submissionId &&
        existing.status === input.status &&
        existing.assigneeId === input.assigneeId &&
        existing.changedBy === input.actorId;
      return sameChange ? 'replayed' : 'taken';
    }
    if (submission.statusId !== input.fromStatusId) return 'stale';

    const current = await headStatusOf(tx, submission.statusId);
    if (!canChangeReviewStatus(input.allowStatusUpdates ?? true, current?.status)) {
      return 'updates_off';
    }
    const moves = current ? (SUBMISSION_STATUS_MOVES[current.status] ?? []) : [];
    if (!moves.includes(input.status)) return 'not_allowed';
    if (input.onlyFrom && current?.status !== input.onlyFrom) return 'not_allowed';

    const inserted = await tx
      .insert(submissionStatuses)
      .values({
        id: input.id,
        workspaceId: input.workspaceId,
        submissionId: input.submissionId,
        status: input.status,
        assigneeId: input.assigneeId,
        changedBy: input.actorId,
        changedByLabel: input.actorDisplayLabel,
      })
      .onConflictDoNothing({ target: submissionStatuses.id })
      .returning({ id: submissionStatuses.id });
    // Another submission's change took the id between the read above and the insert.
    if (inserted.length === 0) return 'taken';
    if (input.comment) {
      await tx.insert(submissionNotes).values({
        id: input.id,
        workspaceId: input.workspaceId,
        submissionId: input.submissionId,
        text: input.comment,
        createdBy: input.actorId,
        createdByLabel: input.actorDisplayLabel,
      });
    }

    const workflowState = workflowStateAfter(current?.status, input.status);
    const restored =
      workflowState === SubmissionWorkflowState.submitted
        ? await restoreLastSettled(tx, {
            workspaceId: input.workspaceId,
            submissionId: input.submissionId,
            headRevisionId: submission.headRevisionId,
            engineSubmissionRef: submission.engineSubmissionRef,
            actorId: input.actorId,
          })
        : null;
    await tx
      .update(submissions)
      .set({
        statusId: input.id,
        ...(workflowState
          ? { workflowState, updatedBy: input.actorDisplayLabel, updatedAt: new Date() }
          : {}),
        ...restored,
      })
      .where(eq(submissions.id, input.submissionId));
    await input.onChanged?.(tx);
    return 'changed';
  });
