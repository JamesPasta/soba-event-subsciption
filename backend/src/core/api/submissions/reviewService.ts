import {
  ApiErrorCodes,
  Permissions,
  SubmissionReviewStatuses,
  type AddSubmissionNoteBody,
  type ReviseSubmissionBody,
  type SubmissionReview,
  type SubmissionReviewers,
  type UpdateSubmissionStatusBody,
} from '@soba/lib';
import { findEffectiveReviewSettings } from '../../../features/form-settings/review/repo';
import { listFormUserIdsHolding } from '../../db/repos/formAccessRepo';
import {
  addNote,
  changeStatus,
  listEdits,
  listNotes,
  listReviewUsers,
  listStatusHistory,
} from '../../db/repos/submissionReviewRepo';
import { getSubmissionRecordById } from '../../db/repos/submissionRepo';
import { getPublicUser } from '../../services/publicUser';
import { notificationService } from '../../../features/notifications/service';
import { canReviewForm } from '../../../features/submission-review/assignee';
import { sendsStatusEmail } from '../../../features/submission-review/statusEmails';
import { JobType } from '../../db/codes';
import { nudgeJobs } from '../../jobs';
import { enqueueStatusEmailJob } from '../../jobs/enqueue';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../errors';
import type { SubmissionsContextInput } from './serviceFactory';

/** The review routes resolve the submission's form before they run. */
export type SubmissionReviewContext = SubmissionsContextInput & { formId?: string };

const formIdOf = (ctx: SubmissionReviewContext): string => {
  if (!ctx.formId) throw new Error('The submission review routes must resolve the form first');
  return ctx.formId;
};

const notFound = () =>
  new NotFoundError('Submission not found', ApiErrorCodes.submission_not_found);

/**
 * A revision is asked of the person who submitted; an anonymous submission has no one to ask, and
 * every anonymous caller would hold its grant.
 */
const assertRevisable = async (workspaceId: string, submissionId: string): Promise<void> => {
  const [record, publicUser] = await Promise.all([
    getSubmissionRecordById(workspaceId, submissionId),
    getPublicUser(),
  ]);
  if (!record) throw notFound();
  if (!record.submittedBy || record.submittedBy === publicUser?.id) {
    throw new ConflictError(
      'An anonymous submission cannot be sent back to revise',
      ApiErrorCodes.revision_needs_submitter,
    );
  }
};

/** An assignee is an active user holding submission_review on the form, as the picker lists them. */
const assertAssignable = async (
  workspaceId: string,
  formId: string,
  assigneeId: string,
): Promise<void> => {
  if (!(await canReviewForm(workspaceId, formId, assigneeId))) {
    throw new ValidationError(
      'The assignee cannot review submissions of this form',
      ApiErrorCodes.assignee_invalid,
    );
  }
};

const read = async (ctx: SubmissionReviewContext, submissionId: string) => {
  const [settings, statusHistory, notes, editHistory] = await Promise.all([
    findEffectiveReviewSettings(ctx.workspaceId, formIdOf(ctx)),
    listStatusHistory(ctx.workspaceId, submissionId),
    listNotes(ctx.workspaceId, submissionId),
    listEdits(ctx.workspaceId, submissionId),
  ]);
  return {
    allowStatusUpdates: settings.allowStatusUpdates,
    statusHistory,
    notes,
    editHistory,
  } satisfies SubmissionReview;
};

/** A submission's review: its status history, staff notes and edit history. */
export const submissionReviewService = {
  get: (ctx: SubmissionReviewContext, submissionId: string): Promise<SubmissionReview> =>
    read(ctx, submissionId),

  /** Adds a note under the client's id; a retry of the same note adds nothing more. */
  async addNote(
    ctx: SubmissionReviewContext,
    submissionId: string,
    body: AddSubmissionNoteBody,
  ): Promise<SubmissionReview> {
    const outcome = await addNote({
      id: body.id,
      workspaceId: ctx.workspaceId,
      submissionId,
      text: body.text,
      actorId: ctx.actorId,
      actorDisplayLabel: ctx.actorDisplayLabel,
    });
    if (outcome === 'missing') throw notFound();
    if (outcome === 'taken') {
      throw new ConflictError('Note id is already used', ApiErrorCodes.note_id_taken);
    }
    return read(ctx, submissionId);
  },

  /** Who the submission can be assigned to: everyone holding submission_review on its form. */
  async listReviewers(ctx: SubmissionReviewContext): Promise<SubmissionReviewers> {
    const userIds = await listFormUserIdsHolding(
      ctx.workspaceId,
      formIdOf(ctx),
      Permissions.submission_review,
    );
    return { items: await listReviewUsers(userIds) };
  },

  /**
   * Moves the submission to a new status when the form's review settings allow it or the move ends a
   * revision, the move is allowed from the current status, and the status has not moved on since the
   * reviewer saw it. An assignee must hold submission_review on the form. A retry of the same change
   * makes it once.
   */
  async updateStatus(
    ctx: SubmissionReviewContext,
    submissionId: string,
    body: UpdateSubmissionStatusBody,
  ): Promise<SubmissionReview> {
    const formId = formIdOf(ctx);
    const settings = await findEffectiveReviewSettings(ctx.workspaceId, formId);
    if (body.assigneeId) await assertAssignable(ctx.workspaceId, formId, body.assigneeId);
    if (body.status === SubmissionReviewStatuses.revising) {
      await assertRevisable(ctx.workspaceId, submissionId);
    }
    const emails =
      sendsStatusEmail(body.status, body.assigneeId, ctx.actorId) &&
      (await notificationService.enabled());

    const queued = { email: false };
    const outcome = await changeStatus({
      id: body.id,
      workspaceId: ctx.workspaceId,
      submissionId,
      fromStatusId: body.fromStatusId,
      status: body.status,
      assigneeId: body.assigneeId,
      actorId: ctx.actorId,
      actorDisplayLabel: ctx.actorDisplayLabel,
      allowStatusUpdates: settings.allowStatusUpdates,
      comment: body.comment || undefined,
      // The email's job commits with the change, so a change that rolls back emails no one.
      onChanged: emails
        ? async (tx) => {
            queued.email = await enqueueStatusEmailJob(tx, {
              workspaceId: ctx.workspaceId,
              formId,
              submissionId,
              actorId: ctx.actorId,
              statusChangeId: body.id,
              attachComment: Boolean(body.attachCommentToEmail && body.comment),
            });
          }
        : undefined,
    });
    if (queued.email) nudgeJobs(JobType.submission_status_email);
    switch (outcome) {
      case 'missing':
        throw notFound();
      case 'taken':
        throw new ConflictError('Status change id is already used', ApiErrorCodes.status_id_taken);
      case 'stale':
        throw new ConflictError(
          'The status changed since it was read',
          ApiErrorCodes.status_changed,
        );
      case 'updates_off':
        throw new ForbiddenError(
          'Status updates are turned off for this form',
          ApiErrorCodes.status_updates_disabled,
        );
      case 'not_allowed':
        throw new ConflictError(
          'This move is not allowed from the current status',
          ApiErrorCodes.status_move_not_allowed,
        );
      default:
        return read(ctx, submissionId);
    }
  },

  /**
   * The owner sends their own submission back to revise: Submitted to Revising, under the id the
   * client chose, from the status the route read. The route has applied reviseStatusOf to the caller.
   */
  async reviseOwn(
    input: SubmissionsContextInput & { submissionId: string; fromStatusId: string | null },
    body: ReviseSubmissionBody,
  ): Promise<void> {
    const outcome = input.fromStatusId
      ? await changeStatus({
          id: body.id,
          workspaceId: input.workspaceId,
          submissionId: input.submissionId,
          fromStatusId: input.fromStatusId,
          status: SubmissionReviewStatuses.revising,
          assigneeId: null,
          actorId: input.actorId,
          actorDisplayLabel: input.actorDisplayLabel,
          onlyFrom: SubmissionReviewStatuses.submitted,
        })
      : 'not_allowed';
    if (outcome === 'missing') throw notFound();
    if (outcome === 'taken') {
      throw new ConflictError('Status change id is already used', ApiErrorCodes.status_id_taken);
    }
    if (outcome === 'stale' || outcome === 'not_allowed') {
      throw new ConflictError(
        'The submission can no longer be revised by its submitter',
        ApiErrorCodes.revise_closed,
      );
    }
  },
};
