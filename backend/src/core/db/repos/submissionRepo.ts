import {
  and,
  count,
  eq,
  getTableColumns,
  ilike,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';
import {
  MY_SUBMISSION_STATES,
  STAFF_SUBMISSION_SORT_FIELDS,
  SUBMISSION_CONFIRMED_STATES,
  SUBMISSION_SORT_FIELDS,
  type MySubmissionState,
  type SortLocale,
  type StaffSubmissionListSort,
  type SubmissionListSort,
  type SubmissionReviewStatus,
} from '@soba/lib';
import { db, type DbOrTx, type Tx } from '../client';
import {
  appUsers,
  submissionParticipants,
  submissionRevisions,
  submissionStatuses,
  submissions,
  forms,
  formVersions,
} from '../schema';
import { likePattern, orderByForSort, type SortColumns } from '../listSort';
import { readListPage } from '../listRead';
import {
  RevisionReason,
  RevisionStatus,
  SubmissionEventType,
  SubmissionParticipantRole,
  SubmissionParticipantStatus,
  SubmissionWorkflowState,
  type RevisionReasonCode,
  type RevisionStatusCode,
  type SubmissionWriteEventCode,
  type SubmissionWorkflowStateCode,
} from '../codes';
import { listAllowsNothing, permittedFormsWhere, type FormAccessGrant } from './formAccessRepo';
import { liveSubmission } from './liveRows';
import { isActiveOwner } from './submissionParticipantRepo';
import { recordSubmittedStatus } from './submissionReviewRepo';
import { demoteHead, nextRevisionNo, resolveRevisionStanding } from './submissionRevisionChain';
import { listSubmitterForms, type SubmitterFormListRow } from './submitterFormRepo';

export type SubmissionRecord = typeof submissions.$inferSelect;

export interface SubmissionListRow {
  id: string;
  formId: string;
  form: { name: string | null };
  formVersionId: string;
  formVersion: { versionNo: number | null };
  workflowState: string;
  engineSyncStatus: string;
  submittedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  submittedBy: string | null;
  confirmationCode: string;
}

/** A row of the staff list: the submission, where its review stands and who has it. */
export interface StaffSubmissionListRow extends SubmissionListRow {
  reviewStatus: string | null;
  assignee: { id: string; profile: unknown; label: string | null } | null;
}

export interface SubmissionDetailRow extends SubmissionListRow {
  currentRevisionNo: number;
  headRevisionId: string | null;
}

/** A submission row with its form's name and its version's number, as responses show them. */
export type LabelledSubmissionRecord = SubmissionRecord &
  Pick<SubmissionDetailRow, 'form' | 'formVersion'>;

interface CreateSubmissionInput {
  /** Client-minted uuidv7; the submission's primary key (no longer server-generated). */
  id: string;
  workspaceId: string;
  formId: string;
  formVersionId: string;
  actorId: string;
  actorDisplayLabel: string | null;
  confirmationCode: string;
}

/**
 * created - the id was free; a new opened submission, its revision 0 and the opener's owner grant
 *           were written.
 * taken   - the id is in use. `live` is that submission unless it, its form or its version is
 *           deleted, and `owner` whether the opener holds its active owner grant. The caller decides
 *           whether the open is a retry.
 */
export type OpenSubmissionResult =
  | { outcome: 'created'; record: SubmissionRecord }
  | { outcome: 'taken'; live: SubmissionRecord | null; owner: boolean };

export interface SaveSubmissionInput {
  workspaceId: string;
  submissionId: string;
  /** Minted before the engine write; the engine document is keyed on it. */
  revisionId: string;
  /** Head the write was based on; for a pending write, the branch point off the current chain. */
  parentRevisionId: string | null;
  actorId: string;
  actorDisplayLabel: string | null;
  eventType: SubmissionWriteEventCode;
  /**
   * The gate's intent. 'current' applies the revision as the new head; 'pending' holds it for review.
   * An intended-'current' write whose head moved since the gate read is downgraded to pending here.
   */
  status: Extract<RevisionStatusCode, 'current' | 'pending'>;
  /** Reason for a pending intent (conflict|closed); ignored when the write lands as current. */
  reason: RevisionReasonCode;
  /** Target workflow state, applied only when the write lands as current (see submissionLifecycle). */
  workflowState: SubmissionWorkflowStateCode;
  /** Engine ref of the newly-created submission document for this revision (the "after" ref). */
  afterEngineSubmissionRef: string;
}

/**
 * appended: the revision was recorded and is the new head.
 * pending: the revision was recorded off the current chain; head, state and current ref are unchanged.
 * replayed: this revision id was already recorded on the submission; nothing was written.
 * not_found: the submission is missing or soft-deleted.
 */
export type AppendSubmissionRevisionResult =
  | { outcome: 'not_found' }
  | {
      outcome: 'appended' | 'pending' | 'replayed';
      record: SubmissionRecord;
      revisionId: string;
      revisionNo: number;
      status: RevisionStatusCode;
      reason: RevisionReasonCode;
    };

/** Runs in the append transaction when the write lands as the new head; a throw rolls it back. */
export type OnRevisionAppended = (tx: Tx, record: SubmissionRecord) => Promise<void>;

export type SubmissionListSortField = (typeof SUBMISSION_SORT_FIELDS)[number];

const SUBMISSION_SORT_COLUMNS: SortColumns<SubmissionListSortField> = {
  formName: { column: forms.name, linguistic: true },
  // Only a submitted submission has one, so an unsubmitted row never leads either direction.
  submittedAt: { column: submissions.submittedAt, nullable: true },
  createdAt: { column: submissions.createdAt },
  updatedAt: { column: submissions.updatedAt },
};

/** The status head and its assignee, joined by the staff list. */
const reviewAssignees = alias(appUsers, 'review_assignee');

const STAFF_SUBMISSION_SORT_COLUMNS: SortColumns<(typeof STAFF_SUBMISSION_SORT_FIELDS)[number]> = {
  ...SUBMISSION_SORT_COLUMNS,
  // Only a submitted submission has a review status, and only an assigned one an assignee.
  reviewStatus: { column: submissionStatuses.status, nullable: true },
  // The name the row shows: the profile's, else the stamp label.
  assignee: {
    column: sql`coalesce(${reviewAssignees.profile}->>'displayName', ${reviewAssignees.displayLabel})`,
    nullable: true,
    linguistic: true,
  },
};

export interface ParticipantSubmissionListRow {
  id: string;
  formId: string;
  formName: string;
  formVersionId: string;
  workflowState: string;
  /** The user's own grant on the submission. */
  role: string;
  headRevisionId: string | null;
  currentRevisionNo: number;
  submittedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  confirmationCode: string;
  /** The review status; null until the submission is submitted. */
  reviewStatus: string | null;
}

export interface ListParticipantSubmissionsInput {
  userId: string;
  offset: number;
  limit: number;
  workflowState?: MySubmissionState;
  q?: string;
  sort: SubmissionListSort;
  locale: SortLocale;
}

export interface ListSubmissionsInput {
  /** The anchored workspace, or every workspace the actor is an active member of. */
  workspaceIds: string[];
  formAccess: FormAccessGrant;
  offset: number;
  limit: number;
  formId?: string;
  formVersionId?: string;
  submissionId?: string;
  workflowState?: string;
  /** Only submissions with a review status, leaving out those not yet submitted. */
  inReviewOnly?: boolean;
  reviewStatus?: SubmissionReviewStatus;
  assigneeId?: string;
  createdBy?: string;
  q?: string;
  sort: StaffSubmissionListSort;
  locale: SortLocale;
}

/** The submission row when neither it, its form nor its form version is deleted. */
export const findLiveSubmissionRecord = async (
  submissionId: string,
  executor: DbOrTx = db,
): Promise<SubmissionRecord | null> => {
  const [row] = await executor
    .select(getTableColumns(submissions))
    .from(submissions)
    .innerJoin(forms, eq(submissions.formId, forms.id))
    .innerJoin(formVersions, eq(submissions.formVersionId, formVersions.id))
    .where(and(eq(submissions.id, submissionId), liveSubmission))
    .limit(1);
  return row ?? null;
};

/**
 * Open a submission against a client-minted id: insert the row in the `opened` state, its
 * revision-0 `opened` event and the opener's owner grant in one transaction, so every submission has
 * a full history and an owner from the moment a fill begins. `submittedBy` captures the actor who
 * started it (the seeded public user for anonymous fills, who then owns it).
 *
 * `ON CONFLICT DO NOTHING` is the atomic gate: the row is only written when the id is free, so
 * concurrent double-opens are race-safe: the loser inserts nothing, falls through to the select, and
 * sees the winner's committed row. A taken id reports what holds it.
 */
export const openSubmission = (input: CreateSubmissionInput): Promise<OpenSubmissionResult> => {
  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(submissions)
      .values({
        id: input.id,
        workspaceId: input.workspaceId,
        formId: input.formId,
        formVersionId: input.formVersionId,
        workflowState: SubmissionWorkflowState.opened,
        submittedBy: input.actorId,
        engineSyncStatus: 'pending',
        currentRevisionNo: 0,
        confirmationCode: input.confirmationCode,
        createdBy: input.actorDisplayLabel,
        updatedBy: input.actorDisplayLabel,
      })
      // A taken confirmation code throws so the caller retries with a new one.
      .onConflictDoNothing({ target: submissions.id })
      .returning();

    if (created) {
      const revisionId = uuidv7();
      await tx.insert(submissionRevisions).values({
        id: revisionId,
        workspaceId: input.workspaceId,
        submissionId: created.id,
        revisionNo: 0,
        eventType: SubmissionEventType.opened,
        status: RevisionStatus.current,
        reason: RevisionReason.accepted,
        beforeEngineSubmissionRef: null,
        afterEngineSubmissionRef: null,
        changedBy: input.actorId,
      });
      await tx.insert(submissionParticipants).values({
        workspaceId: input.workspaceId,
        submissionId: created.id,
        userId: input.actorId,
        role: SubmissionParticipantRole.owner,
        status: SubmissionParticipantStatus.active,
        grantedBy: input.actorId,
        createdBy: input.actorDisplayLabel,
        updatedBy: input.actorDisplayLabel,
      });
      const [record] = await tx
        .update(submissions)
        .set({ headRevisionId: revisionId })
        .where(eq(submissions.id, created.id))
        .returning();
      if (!record) throw new Error(`Submission ${created.id} missing after insert`);
      return { outcome: 'created', record };
    }

    const live = await findLiveSubmissionRecord(input.id, tx);
    const owner = !!live && (await isActiveOwner(live.id, input.actorId, tx));
    return { outcome: 'taken', live, owner };
  });
};

/** The form's name and the version's number for a form version, deleted or not. */
export const getFormVersionLabels = async (
  formVersionId: string,
): Promise<Pick<SubmissionDetailRow, 'form' | 'formVersion'> | null> => {
  const [row] = await db
    .select({ form: { name: forms.name }, formVersion: { versionNo: formVersions.versionNo } })
    .from(formVersions)
    .innerJoin(forms, eq(forms.id, formVersions.formId))
    .where(eq(formVersions.id, formVersionId))
    .limit(1);
  return row ?? null;
};

/** Look up a revision by id alone, to recognise a retried write and report its standing. */
export const getSubmissionRevisionById = async (
  revisionId: string,
): Promise<{
  submissionId: string;
  eventType: string;
  changedBy: string | null;
  revisionNo: number;
  status: string;
  reason: string;
} | null> => {
  const rows = await db
    .select({
      submissionId: submissionRevisions.submissionId,
      eventType: submissionRevisions.eventType,
      changedBy: submissionRevisions.changedBy,
      revisionNo: submissionRevisions.revisionNo,
      status: submissionRevisions.status,
      reason: submissionRevisions.reason,
    })
    .from(submissionRevisions)
    .where(eq(submissionRevisions.id, revisionId))
    .limit(1);
  return rows[0] ?? null;
};

/** Fetch the raw (non-deleted) submission row — used by the engine write path. */
export const getSubmissionRecordById = async (
  workspaceId: string,
  submissionId: string,
): Promise<SubmissionRecord | null> => {
  const rows = await db
    .select()
    .from(submissions)
    .where(
      and(
        eq(submissions.workspaceId, workspaceId),
        eq(submissions.id, submissionId),
        isNull(submissions.deletedAt),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
};

export const getSubmissionById = async (
  workspaceId: string,
  submissionId: string,
): Promise<SubmissionDetailRow | null> => {
  const row = await db
    .select({
      id: submissions.id,
      formId: submissions.formId,
      form: { name: forms.name },
      formVersionId: submissions.formVersionId,
      formVersion: { versionNo: formVersions.versionNo },
      workflowState: submissions.workflowState,
      engineSyncStatus: submissions.engineSyncStatus,
      currentRevisionNo: submissions.currentRevisionNo,
      headRevisionId: submissions.headRevisionId,
      submittedAt: submissions.submittedAt,
      createdAt: submissions.createdAt,
      updatedAt: submissions.updatedAt,
      createdBy: submissions.createdBy,
      submittedBy: submissions.submittedBy,
      confirmationCode: submissions.confirmationCode,
    })
    .from(submissions)
    .leftJoin(forms, eq(submissions.formId, forms.id))
    .leftJoin(formVersions, eq(submissions.formVersionId, formVersions.id))
    .where(
      and(
        eq(submissions.workspaceId, workspaceId),
        eq(submissions.id, submissionId),
        isNull(submissions.deletedAt),
      ),
    )
    .limit(1);

  return row[0] ?? null;
};

/**
 * Resolve list-scope context for a submission by id alone. Returns null when the submission is
 * missing, or it, its form or its form version is deleted.
 */
export const getSubmissionListContext = async (
  submissionId: string,
): Promise<{ workspaceId: string; formId: string; formVersionId: string } | null> => {
  const row = await db
    .select({
      workspaceId: submissions.workspaceId,
      formId: submissions.formId,
      formVersionId: submissions.formVersionId,
    })
    .from(submissions)
    .innerJoin(forms, eq(submissions.formId, forms.id))
    .innerJoin(formVersions, eq(submissions.formVersionId, formVersions.id))
    .where(and(eq(submissions.id, submissionId), liveSubmission))
    .limit(1);

  return row[0] ?? null;
};

/**
 * Resolve a submission's workspace, form and workflow state by id alone. Returns null when the
 * submission is missing, or it, its form or its form version is deleted.
 */
export const getSubmissionWorkspaceAndState = async (
  submissionId: string,
): Promise<{
  workspaceId: string;
  formId: string;
  workflowState: string;
} | null> => {
  const rows = await db
    .select({
      workspaceId: submissions.workspaceId,
      formId: submissions.formId,
      workflowState: submissions.workflowState,
    })
    .from(submissions)
    .innerJoin(forms, eq(submissions.formId, forms.id))
    .innerJoin(formVersions, eq(submissions.formVersionId, formVersions.id))
    .where(and(eq(submissions.id, submissionId), liveSubmission))
    .limit(1);
  return rows[0] ?? null;
};

// Codes are hidden until submitted, so only a row showing its code matches on it.
const shownCodeMatches = (pattern: string) =>
  and(
    inArray(submissions.workflowState, [...SUBMISSION_CONFIRMED_STATES]),
    ilike(submissions.confirmationCode, pattern),
  );

export const listSubmissionsForWorkspace = async (
  input: ListSubmissionsInput,
): Promise<{ items: StaffSubmissionListRow[]; total: number }> => {
  if (listAllowsNothing(input.workspaceIds, input.formAccess)) {
    return { items: [], total: 0 };
  }
  const whereClauses = [
    inArray(submissions.workspaceId, input.workspaceIds),
    liveSubmission,
    permittedFormsWhere(input.formAccess, {
      workspaceId: submissions.workspaceId,
      formId: submissions.formId,
    }),
    // Workspace/staff list shows only real submissions; a just-`opened` shell isn't one yet.
    ne(submissions.workflowState, SubmissionWorkflowState.opened),
  ];

  if (input.formId) {
    whereClauses.push(eq(submissions.formId, input.formId));
  }

  if (input.formVersionId) {
    whereClauses.push(eq(submissions.formVersionId, input.formVersionId));
  }

  if (input.submissionId) {
    whereClauses.push(eq(submissions.id, input.submissionId));
  }

  if (input.workflowState) {
    whereClauses.push(eq(submissions.workflowState, input.workflowState));
  }

  if (input.inReviewOnly) {
    whereClauses.push(isNotNull(submissions.statusId));
  }

  if (input.reviewStatus) {
    whereClauses.push(eq(submissionStatuses.status, input.reviewStatus));
  }

  if (input.assigneeId) {
    whereClauses.push(eq(submissionStatuses.assigneeId, input.assigneeId));
  }

  if (input.createdBy) {
    whereClauses.push(eq(submissions.createdBy, input.createdBy));
  }

  if (input.q) {
    const pattern = likePattern(input.q);
    whereClauses.push(
      or(
        ilike(forms.name, pattern),
        sql`${submissions.id}::text ilike ${pattern}`,
        shownCodeMatches(pattern),
      ),
    );
  }

  const where = and(...whereClauses);

  return readListPage(async (tx) => {
    const items = await tx
      .select({
        id: submissions.id,
        formId: submissions.formId,
        form: { name: forms.name },
        formVersionId: submissions.formVersionId,
        formVersion: { versionNo: formVersions.versionNo },
        workflowState: submissions.workflowState,
        engineSyncStatus: submissions.engineSyncStatus,
        submittedAt: submissions.submittedAt,
        createdAt: submissions.createdAt,
        updatedAt: submissions.updatedAt,
        createdBy: submissions.createdBy,
        submittedBy: submissions.submittedBy,
        confirmationCode: submissions.confirmationCode,
        reviewStatus: submissionStatuses.status,
        assigneeId: reviewAssignees.id,
        assigneeProfile: reviewAssignees.profile,
        assigneeLabel: reviewAssignees.displayLabel,
      })
      .from(submissions)
      .innerJoin(forms, eq(submissions.formId, forms.id))
      .innerJoin(formVersions, eq(submissions.formVersionId, formVersions.id))
      .leftJoin(submissionStatuses, eq(submissionStatuses.id, submissions.statusId))
      .leftJoin(reviewAssignees, eq(reviewAssignees.id, submissionStatuses.assigneeId))
      .where(where)
      .orderBy(
        ...orderByForSort(STAFF_SUBMISSION_SORT_COLUMNS, input.sort, submissions.id, input.locale),
      )
      .limit(input.limit)
      .offset(input.offset);

    // Every join is on a unique key, so none multiplies a row; the status join serves the filters.
    const totals = await tx
      .select({ total: count() })
      .from(submissions)
      .leftJoin(submissionStatuses, eq(submissionStatuses.id, submissions.statusId))
      .innerJoin(forms, eq(submissions.formId, forms.id))
      .innerJoin(formVersions, eq(submissions.formVersionId, formVersions.id))
      .where(where);

    return {
      items: items.map(({ assigneeId, assigneeProfile, assigneeLabel, ...row }) => ({
        ...row,
        assignee: assigneeId
          ? { id: assigneeId, profile: assigneeProfile, label: assigneeLabel }
          : null,
      })),
      total: totals[0]?.total ?? 0,
    };
  });
};

/**
 * The draft, submitted and revising submissions the user holds an active grant on, across every
 * workspace, with the forms of the page's rows and their facts for the user, read in one snapshot.
 * An opened submission holds no answers yet, and a submission on a deleted form or form version
 * can no longer be opened, so none of these is listed.
 */
export const listSubmissionsForParticipant = async (
  input: ListParticipantSubmissionsInput,
): Promise<{
  items: ParticipantSubmissionListRow[];
  total: number;
  forms: SubmitterFormListRow[];
}> => {
  const whereClauses = [
    eq(submissionParticipants.userId, input.userId),
    eq(submissionParticipants.status, SubmissionParticipantStatus.active),
    liveSubmission,
    input.workflowState
      ? eq(submissions.workflowState, input.workflowState)
      : inArray(submissions.workflowState, [...MY_SUBMISSION_STATES]),
  ];

  if (input.q) {
    const pattern = likePattern(input.q);
    whereClauses.push(or(ilike(forms.name, pattern), shownCodeMatches(pattern)));
  }

  const where = and(...whereClauses);

  return readListPage(async (tx) => {
    const items = await tx
      .select({
        id: submissions.id,
        formId: submissions.formId,
        formName: forms.name,
        formVersionId: submissions.formVersionId,
        workflowState: submissions.workflowState,
        role: submissionParticipants.role,
        headRevisionId: submissions.headRevisionId,
        currentRevisionNo: submissions.currentRevisionNo,
        submittedAt: submissions.submittedAt,
        createdAt: submissions.createdAt,
        updatedAt: submissions.updatedAt,
        confirmationCode: submissions.confirmationCode,
        reviewStatus: submissionStatuses.status,
      })
      .from(submissionParticipants)
      .innerJoin(submissions, eq(submissionParticipants.submissionId, submissions.id))
      .innerJoin(forms, eq(submissions.formId, forms.id))
      .innerJoin(formVersions, eq(submissions.formVersionId, formVersions.id))
      .leftJoin(submissionStatuses, eq(submissionStatuses.id, submissions.statusId))
      .where(where)
      .orderBy(...orderByForSort(SUBMISSION_SORT_COLUMNS, input.sort, submissions.id, input.locale))
      .limit(input.limit)
      .offset(input.offset);

    // One active grant per user and submission, so the joins never repeat a submission.
    const totals = await tx
      .select({ total: count() })
      .from(submissionParticipants)
      .innerJoin(submissions, eq(submissionParticipants.submissionId, submissions.id))
      .innerJoin(forms, eq(submissions.formId, forms.id))
      .innerJoin(formVersions, eq(submissions.formVersionId, formVersions.id))
      .where(where);

    const formIds = [...new Set(items.map((item) => item.formId))];
    const pageForms = await listSubmitterForms({ userId: input.userId, formIds }, tx);
    const byId = (a: SubmitterFormListRow, b: SubmitterFormListRow) => a.id.localeCompare(b.id);

    return { items, total: totals[0]?.total ?? 0, forms: pageForms.toSorted(byId) };
  });
};

export const updateSubmissionDraft = async (
  workspaceId: string,
  submissionId: string,
  actorDisplayLabel: string | null,
  patch: Partial<{
    workflowState: string;
    engineSubmissionRef: string;
    engineSyncStatus: string;
    engineSyncError: string | null;
    submittedBy: string;
    submittedAt: Date;
  }>,
) => {
  const updated = await db
    .update(submissions)
    .set({
      ...patch,
      updatedBy: actorDisplayLabel,
      updatedAt: new Date(),
    })
    .where(and(eq(submissions.id, submissionId), eq(submissions.workspaceId, workspaceId)))
    .returning();

  return updated[0] ?? null;
};

/**
 * Reset a `provisioning` flag left by a write that did not land. The flag may belong to another write
 * still in flight; that write sets its own final status.
 */
export const clearSubmissionProvisioning = async (workspaceId: string, submissionId: string) => {
  await db
    .update(submissions)
    .set({ engineSyncStatus: 'ready' })
    .where(
      and(
        eq(submissions.id, submissionId),
        eq(submissions.workspaceId, workspaceId),
        eq(submissions.engineSyncStatus, 'provisioning'),
      ),
    );
};

/**
 * Record an engine failure. Skipped when another write already settled the status or the submission
 * is deleted, so a failed write never overwrites a successful one.
 */
export const failSubmissionProvisioning = async (
  workspaceId: string,
  submissionId: string,
  actorDisplayLabel: string | null,
  message: string,
) => {
  await db
    .update(submissions)
    .set({
      engineSyncStatus: 'error',
      engineSyncError: message,
      updatedBy: actorDisplayLabel,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(submissions.id, submissionId),
        eq(submissions.workspaceId, workspaceId),
        eq(submissions.engineSyncStatus, 'provisioning'),
        isNull(submissions.deletedAt),
      ),
    );
};

const toAppendResult = (
  outcome: 'appended' | 'pending' | 'replayed',
  record: SubmissionRecord,
  revisionId: string,
  revisionNo: number,
  status: RevisionStatusCode,
  reason: RevisionReasonCode,
): AppendSubmissionRevisionResult => ({ outcome, record, revisionId, revisionNo, status, reason });

/**
 * Lock a live submission row until commit. Save, submit and delete all take this lock first, so a head
 * check and a head move cannot interleave with another writer on the same submission.
 */
const lockLiveSubmission = async (
  tx: Tx,
  workspaceId: string,
  submissionId: string,
): Promise<SubmissionRecord | null> => {
  const [submission] = await tx
    .select()
    .from(submissions)
    .where(
      and(
        eq(submissions.id, submissionId),
        eq(submissions.workspaceId, workspaceId),
        isNull(submissions.deletedAt),
      ),
    )
    .limit(1)
    .for('no key update');
  return submission ?? null;
};

/**
 * Record a submission revision in one transaction. `revisionNo` is the next append-order number over
 * every revision (current and pending), so it is not the current version's number. A 'current' write
 * whose head still matches its base demotes the outgoing head to `superseded`, inserts the new head as
 * `current`, applies the workflow state, marks the engine sync `ready`, and stamps `submitted_at` on
 * the first submit; `afterEngineSubmissionRef` becomes the current ref.
 *
 * A 'pending' write - or a 'current' write whose head moved, or whose submission was submitted, since
 * the gate read it - is recorded off the current chain and the submission row is left entirely untouched (head, current revision no,
 * workflow state, engine ref and sync status all unchanged), so a side-branch write never disturbs the
 * live version. The new engine document stays referenced by the pending revision, so no document is
 * orphaned. The caller's own write of the same event, already recorded under the revision id, is
 * answered as replayed; another write under the id fails on the revision's primary key.
 *
 * `onAppended` runs only on the 'appended' outcome, inside the transaction.
 */
export const appendSubmissionRevision = (
  input: SaveSubmissionInput,
  onAppended?: OnRevisionAppended,
): Promise<AppendSubmissionRevisionResult> => {
  return db.transaction(async (tx) => {
    const submission = await lockLiveSubmission(tx, input.workspaceId, input.submissionId);
    if (!submission) return { outcome: 'not_found' };

    // A concurrent duplicate of this write committed first.
    const [replayed] = await tx
      .select({
        revisionNo: submissionRevisions.revisionNo,
        status: submissionRevisions.status,
        reason: submissionRevisions.reason,
      })
      .from(submissionRevisions)
      .where(
        and(
          eq(submissionRevisions.id, input.revisionId),
          eq(submissionRevisions.submissionId, input.submissionId),
          eq(submissionRevisions.eventType, input.eventType),
          eq(submissionRevisions.changedBy, input.actorId),
        ),
      )
      .limit(1);
    if (replayed) {
      // A current write set 'provisioning' after the winner settled the status; a pending write set
      // nothing, so this reset is a guarded no-op for it.
      const [settled] = await tx
        .update(submissions)
        .set({ engineSyncStatus: 'ready' })
        .where(
          and(
            eq(submissions.id, input.submissionId),
            eq(submissions.engineSyncStatus, 'provisioning'),
          ),
        )
        .returning();
      return toAppendResult(
        'replayed',
        settled ?? submission,
        input.revisionId,
        replayed.revisionNo,
        replayed.status as RevisionStatusCode,
        replayed.reason as RevisionReasonCode,
      );
    }

    const nextRevision = await nextRevisionNo(tx, input.workspaceId, input.submissionId);

    const headMoved = submission.headRevisionId !== input.parentRevisionId;
    const { applyAsCurrent, status, reason } = resolveRevisionStanding(
      input.status,
      input.reason,
      headMoved,
      submission.workflowState,
    );

    await tx.insert(submissionRevisions).values({
      id: input.revisionId,
      workspaceId: input.workspaceId,
      submissionId: input.submissionId,
      revisionNo: nextRevision,
      parentRevisionId: input.parentRevisionId,
      eventType: input.eventType,
      status,
      reason,
      beforeEngineSubmissionRef: applyAsCurrent ? submission.engineSubmissionRef : null,
      afterEngineSubmissionRef: input.afterEngineSubmissionRef,
      changedBy: input.actorId,
    });

    if (!applyAsCurrent) {
      // A pending intent advertised nothing on the submission, so leave the row untouched. A current
      // intent downgraded here (closed or head moved under the lock) had set 'provisioning' before
      // the engine write; clear just that flag, without bumping the current version or its audit
      // fields.
      let record = submission;
      if (input.status === RevisionStatus.current) {
        const [settled] = await tx
          .update(submissions)
          .set({ engineSyncStatus: 'ready' })
          .where(
            and(
              eq(submissions.id, input.submissionId),
              eq(submissions.engineSyncStatus, 'provisioning'),
            ),
          )
          .returning();
        if (settled) record = settled;
      }
      return toAppendResult('pending', record, input.revisionId, nextRevision, status, reason);
    }

    await demoteHead(tx, input.workspaceId, submission.headRevisionId);

    const updates: Partial<typeof submissions.$inferInsert> = {
      currentRevisionNo: nextRevision,
      headRevisionId: input.revisionId,
      engineSubmissionRef: input.afterEngineSubmissionRef,
      engineSyncStatus: 'ready',
      engineSyncError: null,
      workflowState: input.workflowState,
      updatedBy: input.actorDisplayLabel,
      updatedAt: new Date(),
    };

    // submittedBy is stamped at open; record the submit timestamp when the first submit lands. A
    // resubmit after a revision keeps the original time.
    if (input.eventType === SubmissionEventType.submitted && !submission.submittedAt) {
      updates.submittedAt = new Date();
    }

    const [updated] = await tx
      .update(submissions)
      .set(updates)
      .where(
        and(eq(submissions.id, input.submissionId), eq(submissions.workspaceId, input.workspaceId)),
      )
      .returning();

    if (!updated) throw new Error(`Submission ${input.submissionId} missing after head move`);
    // The submit starts the review, in the same transaction, so no submitted row lacks a status.
    if (input.eventType === SubmissionEventType.submitted) {
      await recordSubmittedStatus(tx, {
        workspaceId: input.workspaceId,
        submissionId: input.submissionId,
        actorId: input.actorId,
        actorDisplayLabel: input.actorDisplayLabel,
      });
    }
    await onAppended?.(tx, updated);
    return toAppendResult('appended', updated, input.revisionId, nextRevision, status, reason);
  });
};

/**
 * edited   - the answers changed; `record` is the submission after it.
 * replayed - a retry of an edit already made by the same person; nothing was written.
 * taken    - the revision id is already used by another write.
 * closed   - the submission is not submitted, so its answers are not staff's to change.
 * stale    - the answers changed since the editor loaded them.
 * missing  - the submission is not live in the workspace.
 */
export type StaffEditResult =
  | { outcome: 'edited' | 'replayed'; record: SubmissionRecord }
  | { outcome: 'taken' | 'closed' | 'stale' | 'missing' };

/**
 * Make staff's changed answers current, in one transaction under the submission's lock. The answers
 * are a new engine document, so the edit is a new current revision on top of the one the editor
 * loaded; the workflow and review status stay as they are.
 */
export const appendStaffEdit = (input: {
  workspaceId: string;
  submissionId: string;
  revisionId: string;
  baseRevisionId: string;
  actorId: string;
  actorDisplayLabel: string | null;
  afterEngineSubmissionRef: string;
}): Promise<StaffEditResult> =>
  db.transaction(async (tx) => {
    const submission = await lockLiveSubmission(tx, input.workspaceId, input.submissionId);
    if (!submission) return { outcome: 'missing' };

    const [recorded] = await tx
      .select({
        submissionId: submissionRevisions.submissionId,
        eventType: submissionRevisions.eventType,
        changedBy: submissionRevisions.changedBy,
      })
      .from(submissionRevisions)
      .where(eq(submissionRevisions.id, input.revisionId))
      .limit(1);
    if (recorded) {
      const sameEdit =
        recorded.submissionId === input.submissionId &&
        recorded.eventType === SubmissionEventType.edited &&
        recorded.changedBy === input.actorId;
      return sameEdit ? { outcome: 'replayed', record: submission } : { outcome: 'taken' };
    }
    if (submission.workflowState !== SubmissionWorkflowState.submitted)
      return { outcome: 'closed' };
    if (submission.headRevisionId !== input.baseRevisionId) return { outcome: 'stale' };

    const revisionNo = await nextRevisionNo(tx, input.workspaceId, input.submissionId);
    await demoteHead(tx, input.workspaceId, submission.headRevisionId);
    await tx.insert(submissionRevisions).values({
      id: input.revisionId,
      workspaceId: input.workspaceId,
      submissionId: input.submissionId,
      revisionNo,
      parentRevisionId: submission.headRevisionId,
      eventType: SubmissionEventType.edited,
      status: RevisionStatus.current,
      reason: RevisionReason.accepted,
      beforeEngineSubmissionRef: submission.engineSubmissionRef,
      afterEngineSubmissionRef: input.afterEngineSubmissionRef,
      changedBy: input.actorId,
    });
    const [updated] = await tx
      .update(submissions)
      .set({
        headRevisionId: input.revisionId,
        currentRevisionNo: revisionNo,
        engineSubmissionRef: input.afterEngineSubmissionRef,
        updatedBy: input.actorDisplayLabel,
        updatedAt: new Date(),
      })
      .where(eq(submissions.id, input.submissionId))
      .returning();
    return { outcome: 'edited', record: updated };
  });

/**
 * deleted       - the submission is now soft-deleted.
 * not_found     - the submission is missing or already deleted.
 * not_deletable - its workflow state is not one of the deletable states asked for.
 */
export type DeleteSubmissionResult =
  | { outcome: 'deleted'; record: SubmissionRecord }
  | { outcome: 'not_found' }
  | { outcome: 'not_deletable'; workflowState: string };

/**
 * Soft-delete a submission and record it as a `deleted` revision by the actor, which becomes the
 * current revision. The engine document is unchanged, so the revision's before and after refs are both
 * the current ref. Any live state is deletable unless `deletableStates` narrows it; the state is read
 * under the row lock, so a concurrent submit cannot slip past the check.
 */
export const markSubmissionDeleted = (input: {
  workspaceId: string;
  submissionId: string;
  actorId: string;
  actorDisplayLabel: string | null;
  deletableStates?: readonly string[];
}): Promise<DeleteSubmissionResult> => {
  return db.transaction(async (tx) => {
    const submission = await lockLiveSubmission(tx, input.workspaceId, input.submissionId);
    if (!submission) return { outcome: 'not_found' };
    if (input.deletableStates && !input.deletableStates.includes(submission.workflowState)) {
      return { outcome: 'not_deletable', workflowState: submission.workflowState };
    }

    const revisionNo = await nextRevisionNo(tx, input.workspaceId, input.submissionId);
    const revisionId = uuidv7();
    await demoteHead(tx, input.workspaceId, submission.headRevisionId);
    await tx.insert(submissionRevisions).values({
      id: revisionId,
      workspaceId: input.workspaceId,
      submissionId: input.submissionId,
      revisionNo,
      parentRevisionId: submission.headRevisionId,
      eventType: SubmissionEventType.deleted,
      status: RevisionStatus.current,
      reason: RevisionReason.accepted,
      beforeEngineSubmissionRef: submission.engineSubmissionRef,
      afterEngineSubmissionRef: submission.engineSubmissionRef,
      changedBy: input.actorId,
    });

    const now = new Date();
    const [updated] = await tx
      .update(submissions)
      .set({
        workflowState: SubmissionWorkflowState.deleted,
        currentRevisionNo: revisionNo,
        headRevisionId: revisionId,
        deletedAt: now,
        deletedBy: input.actorDisplayLabel,
        updatedBy: input.actorDisplayLabel,
        updatedAt: now,
      })
      .where(
        and(eq(submissions.id, input.submissionId), eq(submissions.workspaceId, input.workspaceId)),
      )
      .returning();
    if (!updated) throw new Error(`Submission ${input.submissionId} missing after head move`);
    return { outcome: 'deleted', record: updated };
  });
};
