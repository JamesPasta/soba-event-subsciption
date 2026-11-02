import {
  SUBMISSION_IN_PROGRESS_STATES,
  ApiErrorCodes,
  type SortLocale,
  type StaffSubmissionListSort,
  type SubmissionReviewStatus,
} from '@soba/lib';
import {
  appendStaffEdit,
  appendSubmissionRevision,
  clearSubmissionProvisioning,
  failSubmissionProvisioning,
  openSubmission,
  getFormVersionLabels,
  getSubmissionById,
  getSubmissionRecordById,
  getSubmissionRevisionById,
  listSubmissionsForParticipant,
  listSubmissionsForWorkspace,
  markSubmissionDeleted,
  updateSubmissionDraft,
  type AppendSubmissionRevisionResult,
  type LabelledSubmissionRecord,
  type ListParticipantSubmissionsInput,
  type SaveSubmissionInput,
  type SubmissionRecord,
} from '../db/repos/submissionRepo';
import { getFormVersionById, getPublishedVersionForForm } from '../db/repos/formVersionRepo';
import { getFormEngineCodeForForm } from '../db/repos/formRepo';
import type { FormAccessGrant } from '../db/repos/formAccessRepo';
import { createFormEngineAdapter } from '../integrations/form-engine/FormEngineRegistry';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import {
  Features,
  JobType,
  RevisionReason,
  RevisionStatus,
  SubmissionEventType,
  SubmissionWorkflowState,
  type SubmissionWriteEventCode,
  type SubmissionWorkflowStateCode,
} from '../db/codes';
import { nudgeJobs } from '../jobs';
import { enqueueSubmittedJob, queuesSubmittedJob } from '../jobs/enqueue';
import { availableActions } from '../../features/post-submission/resolve';
import {
  decideRecordedWrite,
  decideSubmissionWrite,
  opensSameSubmission,
  replayedLanding,
  type SubmissionWriteDecision,
  type WriteLanding,
} from './submissionWriteGate';
import { withNewConfirmationCode } from './confirmationCode';
import { isFeatureAvailable } from './featureAvailabilityService';
import { isUniqueViolationOn } from '../db/pgError';
import { SUBMISSION_REVISION_PKEY } from '../db/schema';

export interface SubmissionWriteOutcome {
  record: LabelledSubmissionRecord;
  revision: WriteLanding;
}

/** A write as recorded, before its form's name and version number are read. */
interface RecordedWrite {
  record: SubmissionRecord;
  revision: WriteLanding;
}

interface CreateInput {
  /** Client-minted uuidv7 that becomes the submission id. */
  id: string;
  workspaceId: string;
  actorId: string;
  actorDisplayLabel: string | null;
  formId: string;
  /** Must be the form's published version when given. */
  formVersionId?: string;
}

interface SaveInput {
  workspaceId: string;
  actorId: string;
  actorDisplayLabel: string | null;
  submissionId: string;
  data: Record<string, unknown>;
  /** Client-minted id for this write. */
  revisionId: string;
  /** Head the client loaded. */
  baseRevisionId: string;
}

/** Where a submission's answer document lives in its form's engine. */
export interface SubmissionContentRefs {
  engineCode: string;
  engineSchemaRef: string | null;
  engineSubmissionRef: string | null;
}

interface DeleteInput {
  workspaceId: string;
  actorId: string;
  actorDisplayLabel: string | null;
  submissionId: string;
}

interface ListInput {
  workspaceIds: string[];
  actorId: string;
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

/**
 * Record the revision. A submit to a form with post-submission available queues its job in the same
 * transaction and nudges the runner once that commits. The feature checks run first, outside it.
 */
const appendWithJobs = async (
  append: SaveSubmissionInput,
  formId: string,
): Promise<AppendSubmissionRevisionResult> => {
  const queueJob = await queuesSubmittedJob(append.eventType, () =>
    isFeatureAvailable(Features.post_submission, { workspaceId: append.workspaceId, formId }),
  );
  const actions = queueJob ? await availableActions(append.workspaceId, formId) : [];
  const result = await appendSubmissionRevision(
    append,
    queueJob
      ? (tx, record) => enqueueSubmittedJob(tx, record, append.revisionId, append.actorId, actions)
      : undefined,
  );
  if (queueJob && result.outcome === 'appended') nudgeJobs(JobType.submission_submitted);
  return result;
};

const submissionNotFound = () =>
  new NotFoundError('Submission not found', ApiErrorCodes.submission_not_found);

const revisionIdTaken = () =>
  new ConflictError('Revision id already used by another write', ApiErrorCodes.revision_id_taken);

/**
 * Staff change the answers of a submitted submission only, and only the answers the editor loaded:
 * one in progress or sent back to revise is its submitters' to change.
 */
const assertEditable = (
  submission: { workflowState: string; headRevisionId: string | null },
  baseRevisionId: string,
): void => {
  if (submission.workflowState !== SubmissionWorkflowState.submitted) throw editClosed();
  if (submission.headRevisionId !== baseRevisionId) throw dataChanged();
};

const editClosed = () =>
  new ConflictError(
    'Only a submitted submission can be changed by staff',
    ApiErrorCodes.edit_closed,
  );

const dataChanged = () =>
  new ConflictError('The answers changed since they were loaded', ApiErrorCodes.data_changed);

export class SubmissionService {
  /**
   * Open a new submission against the form's currently published version (the only submittable one),
   * under the client-supplied id. Idempotent: a retry of the same id by its owner on the same form,
   * and the same version when it names one, returns the existing live record ({ created: false });
   * another owner, form or version, or a submission, form or version that is deleted, is a 409. A
   * formVersionId that is not the published version is a 409.
   */
  async open(input: CreateInput): Promise<{ created: boolean; record: LabelledSubmissionRecord }> {
    const version = await getPublishedVersionForForm(input.workspaceId, input.formId);
    if (!version)
      throw new NotFoundError('Form has no published version', ApiErrorCodes.not_published);
    if (input.formVersionId && input.formVersionId !== version.id) {
      throw new ConflictError(
        'Form version is not the published version',
        ApiErrorCodes.version_not_published,
      );
    }

    const result = await withNewConfirmationCode((confirmationCode) =>
      openSubmission({ ...input, formVersionId: version.id, confirmationCode }),
    );
    if (result.outcome === 'created') {
      return { created: true, record: await this.labelled(result.record) };
    }
    // A retry asks for what the id holds: the opener's own live submission, by the rule the replay
    // guard applies. Anything else holding the id is a collision.
    const { live } = result;
    const retried = !!live && result.owner && opensSameSubmission(live, input);
    if (!retried) {
      throw new ConflictError('Submission id already in use', ApiErrorCodes.submission_id_taken);
    }
    return { created: false, record: await this.labelled(live) };
  }

  /** Save the current answer data as a draft (opened → draft; draft stays draft). */
  async save(input: SaveInput): Promise<SubmissionWriteOutcome> {
    return this.labelledWrite(await this.record(input, SubmissionEventType.saved));
  }

  /** Submit the answer data (opened/draft → submitted). */
  async submit(input: SaveInput): Promise<SubmissionWriteOutcome> {
    return this.labelledWrite(await this.record(input, SubmissionEventType.submitted));
  }

  /**
   * The row with its form's name and its version's number, read after the write. Labelling keeps the
   * row the write returned; it never reads the submission again.
   */
  private async labelled(record: SubmissionRecord): Promise<LabelledSubmissionRecord> {
    const labels = await getFormVersionLabels(record.formVersionId);
    if (!labels) throw new Error(`Form version ${record.formVersionId} has no row`);
    return { ...record, ...labels };
  }

  private async labelledWrite(write: RecordedWrite): Promise<SubmissionWriteOutcome> {
    return { record: await this.labelled(write.record), revision: write.revision };
  }

  /**
   * Record a save/submit: decide it up front (replay, current or pending), then write it. A `current`
   * write appends on top of the head; a `pending` write - a conflict or a write against a submitted
   * record - is kept off the current chain for staff to resolve, leaving the current version and
   * workflow state untouched. The returned revision says where the write landed.
   */
  private async record(
    input: SaveInput,
    eventType: SubmissionWriteEventCode,
  ): Promise<RecordedWrite> {
    const submission = await getSubmissionRecordById(input.workspaceId, input.submissionId);
    if (!submission) {
      throw submissionNotFound();
    }

    // The replay guard answers most repeats before access; this catches one that lands after it.
    const recorded = decideRecordedWrite({
      submissionId: input.submissionId,
      eventType,
      actorId: input.actorId,
      revisionId: input.revisionId,
      baseRevisionId: input.baseRevisionId,
      recorded: await getSubmissionRevisionById(input.revisionId),
    });
    if (recorded.kind === 'replay') return { record: submission, revision: recorded.revision };

    const decision = decideSubmissionWrite({
      submission,
      eventType,
      baseRevisionId: input.baseRevisionId,
    });

    // The base must be a revision of this submission. A foreign or unknown base is a malformed write,
    // rejected before any engine document is created, so it cannot orphan one or branch across
    // submissions. A base equal to the head is trivially valid.
    if (input.baseRevisionId !== submission.headRevisionId) {
      const base = await getSubmissionRevisionById(input.baseRevisionId);
      if (base?.submissionId !== input.submissionId) {
        throw new ValidationError(
          'baseRevisionId is not a revision of this submission',
          ApiErrorCodes.revision_base_invalid,
        );
      }
    }

    return this.writeRevision(input, submission, eventType, decision);
  }

  /**
   * Create a new (immutable) submission document in the form engine, then record the revision. A
   * `current` write advertises 'provisioning' on the submission, then 'ready' or (on engine failure)
   * 'error'; a deleted submission is a 404 that resets 'provisioning'. A `pending` write never touches
   * the submission's sync status - it is a side branch, so an engine failure on it leaves the live
   * version untouched.
   */
  /**
   * Resolve the submission's own form version and its engine adapter for a write, or throw a
   * ValidationError when the version is unprovisioned, the form has no engine, or the engine does not
   * support submissions.
   */
  private async resolveSubmissionEngine(submission: SubmissionRecord) {
    const version = await getFormVersionById(submission.workspaceId, submission.formVersionId);
    if (!version?.engineSchemaRef) {
      throw new ValidationError(
        'Form version is not provisioned in the engine',
        ApiErrorCodes.form_not_ready,
      );
    }

    const engineCode = await getFormEngineCodeForForm(submission.workspaceId, submission.formId);
    if (!engineCode) {
      throw new ValidationError('Form has no form engine configured', ApiErrorCodes.form_not_ready);
    }

    const adapter = createFormEngineAdapter(engineCode);
    if (typeof adapter.createSubmission !== 'function') {
      throw new ValidationError(
        `Form engine '${engineCode}' does not support submissions`,
        ApiErrorCodes.form_not_ready,
      );
    }

    return {
      engineSchemaRef: version.engineSchemaRef,
      createSubmission: adapter.createSubmission.bind(adapter),
    };
  }

  private async writeRevision(
    input: SaveInput,
    submission: SubmissionRecord,
    eventType: SubmissionWriteEventCode,
    decision: SubmissionWriteDecision,
  ): Promise<RecordedWrite> {
    const { engineSchemaRef, createSubmission } = await this.resolveSubmissionEngine(submission);
    const pending = decision.kind === 'pending';

    // Only a current write advertises in-flight status on the live submission; a pending write is a
    // side branch and must leave the row alone.
    if (!pending) {
      await updateSubmissionDraft(input.workspaceId, input.submissionId, input.actorDisplayLabel, {
        engineSyncStatus: 'provisioning',
        engineSyncError: null,
      });
    }

    const { revisionId } = input;

    try {
      const { engineRef } = await createSubmission({
        engineFormRef: engineSchemaRef,
        submissionId: input.submissionId,
        revisionId,
        workspaceId: input.workspaceId,
        data: input.data,
        validate: eventType === SubmissionEventType.submitted,
      });

      const result = await appendWithJobs(
        {
          workspaceId: input.workspaceId,
          submissionId: input.submissionId,
          revisionId,
          parentRevisionId: decision.parentRevisionId,
          actorId: input.actorId,
          actorDisplayLabel: input.actorDisplayLabel,
          eventType,
          status: pending ? RevisionStatus.pending : RevisionStatus.current,
          reason: pending ? decision.reason : RevisionReason.accepted,
          workflowState: pending
            ? (submission.workflowState as SubmissionWorkflowStateCode)
            : decision.workflowState,
          afterEngineSubmissionRef: engineRef,
        },
        submission.formId,
      ).catch((err: unknown) => {
        // Another write committed this revision id first.
        if (isUniqueViolationOn(err, SUBMISSION_REVISION_PKEY)) {
          throw new ConflictError(
            'Revision id already used by another write',
            ApiErrorCodes.revision_id_taken,
          );
        }
        throw err;
      });

      if (result.outcome === 'not_found') {
        throw submissionNotFound();
      }

      return {
        record: result.record,
        // A concurrent duplicate answers as any replay does, not with the revision's stored status.
        revision:
          result.outcome === 'replayed'
            ? replayedLanding(result.revisionId, result)
            : {
                id: result.revisionId,
                revisionNo: result.revisionNo,
                status: result.status,
                reason: result.reason,
              },
      };
    } catch (err) {
      // A pending write never set a provisioning flag, so there is nothing to reset for it.
      if (pending) throw err;
      // A deleted submission, or a revision id another write took, is not an engine failure.
      if (
        err instanceof NotFoundError ||
        (err instanceof ConflictError && err.code === ApiErrorCodes.revision_id_taken)
      ) {
        await clearSubmissionProvisioning(input.workspaceId, input.submissionId);
        throw err;
      }
      await failSubmissionProvisioning(
        input.workspaceId,
        input.submissionId,
        input.actorDisplayLabel,
        err instanceof Error ? err.message : String(err),
      );
      throw err;
    }
  }

  /**
   * Staff change the answers of a submitted submission. The form engine validates them as a submit
   * does. The checks run before the engine write too, so a refused edit leaves no engine document;
   * the append checks again under the lock. A retry of the same edit by the same person is answered
   * as made.
   */
  async editAsStaff(input: SaveInput): Promise<LabelledSubmissionRecord> {
    const submission = await getSubmissionRecordById(input.workspaceId, input.submissionId);
    if (!submission) {
      throw submissionNotFound();
    }
    const recorded = await getSubmissionRevisionById(input.revisionId);
    if (recorded) {
      const sameEdit =
        recorded.submissionId === input.submissionId &&
        recorded.eventType === SubmissionEventType.edited &&
        recorded.changedBy === input.actorId;
      if (!sameEdit) throw revisionIdTaken();
      return this.labelled(submission);
    }
    assertEditable(submission, input.baseRevisionId);

    const { engineSchemaRef, createSubmission } = await this.resolveSubmissionEngine(submission);
    const { engineRef } = await createSubmission({
      engineFormRef: engineSchemaRef,
      submissionId: input.submissionId,
      revisionId: input.revisionId,
      workspaceId: input.workspaceId,
      data: input.data,
      validate: true,
    });
    const result = await appendStaffEdit({
      workspaceId: input.workspaceId,
      submissionId: input.submissionId,
      revisionId: input.revisionId,
      baseRevisionId: input.baseRevisionId,
      actorId: input.actorId,
      actorDisplayLabel: input.actorDisplayLabel,
      afterEngineSubmissionRef: engineRef,
    }).catch((err: unknown) => {
      if (isUniqueViolationOn(err, SUBMISSION_REVISION_PKEY)) throw revisionIdTaken();
      throw err;
    });
    switch (result.outcome) {
      case 'missing':
        throw submissionNotFound();
      case 'taken':
        throw revisionIdTaken();
      // Moved under the lock after the checks above.
      case 'closed':
        throw editClosed();
      case 'stale':
        throw dataChanged();
      default:
        return this.labelled(result.record);
    }
  }

  /** Staff delete, from any live state. Null when the submission is missing or already deleted. */
  async delete(input: DeleteInput) {
    const result = await markSubmissionDeleted(input);
    return result.outcome === 'deleted' ? result.record : null;
  }

  /**
   * A submitter's delete, only before the submission is submitted; a submitted one is a 409. Null
   * when the submission is missing or already deleted.
   */
  async deleteUnsubmitted(input: DeleteInput) {
    const result = await markSubmissionDeleted({
      ...input,
      deletableStates: SUBMISSION_IN_PROGRESS_STATES,
    });
    if (result.outcome === 'not_deletable') {
      throw new ConflictError(
        `Submission is ${result.workflowState} and can no longer be deleted`,
        ApiErrorCodes.delete_closed,
      );
    }
    return result.outcome === 'deleted' ? result.record : null;
  }

  async get(workspaceId: string, submissionId: string) {
    return getSubmissionById(workspaceId, submissionId);
  }

  /**
   * Reads the submission's current answer document back from the form engine (null if unprovisioned).
   * Pass `record` to reuse an already-loaded submission row instead of re-fetching it.
   */
  async getContent(input: {
    workspaceId: string;
    submissionId: string;
    record?: SubmissionRecord;
  }) {
    const submission =
      input.record ?? (await getSubmissionRecordById(input.workspaceId, input.submissionId));
    if (!submission?.engineSubmissionRef) return null;

    const version = await getFormVersionById(input.workspaceId, submission.formVersionId);
    if (!version?.engineSchemaRef) return null;

    const engineCode = await getFormEngineCodeForForm(input.workspaceId, submission.formId);
    if (!engineCode) return null;

    return this.readContent({
      engineCode,
      engineSchemaRef: version.engineSchemaRef,
      engineSubmissionRef: submission.engineSubmissionRef,
    });
  }

  /** Reads an answer document from the engine by its refs; null when there is nothing to read. */
  async readContent(refs: SubmissionContentRefs) {
    if (!refs.engineSchemaRef || !refs.engineSubmissionRef) return null;
    const adapter = createFormEngineAdapter(refs.engineCode);
    if (typeof adapter.readSubmission !== 'function') return null;
    return adapter.readSubmission(refs.engineSchemaRef, refs.engineSubmissionRef);
  }

  async list(input: ListInput) {
    return listSubmissionsForWorkspace({
      ...input,
    });
  }

  /** The draft and submitted submissions the user takes part in, across every workspace. */
  async listForParticipant(input: ListParticipantSubmissionsInput) {
    return listSubmissionsForParticipant(input);
  }
}
