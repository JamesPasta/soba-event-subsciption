import {
  canDeleteSubmissionFile,
  canReadSubmission,
  canRenderSubmission,
  canUploadSubmissionFile,
  canWriteSubmission,
  ownDeleteStatusOf,
  reviseStatusOf,
  SubmissionChangeStatus,
} from '@soba/lib';
import { Permissions } from '../db/codes';
import {
  hasFormSubmitAccess,
  type CallerIdentity,
  type FormAccessTarget,
} from '../db/repos/formSubmitAccessRepo';
import {
  findSubmitterSubmission,
  type SubmitterSubmission,
} from '../db/repos/submitterSubmissionRepo';

/** What a caller does through submit mode. Design-mode routes do not use this policy. */
export const SubmitterOperation = {
  /** Open a new submission on a form. */
  open: 'open',
  /** Read an existing submission: confirmation, data, schema, fill bundle, file download. */
  read: 'read',
  /** Save or submit. */
  write: 'write',
  /** Upload a file to a submission still in progress. */
  upload: 'upload',
  /** Delete a file: a write while in progress, the form's update permission once submitted. */
  deleteFile: 'deleteFile',
  /** Render a document from a submission with a stored template: print, template list. */
  render: 'render',
  /** Delete the caller's own submission; the lifecycle limits it to one not yet submitted. */
  delete: 'delete',
  /** Send the caller's own submitted submission back to revise. */
  revise: 'revise',
} as const;
export type SubmitterOperationCode = (typeof SubmitterOperation)[keyof typeof SubmitterOperation];

/** The form an operation is on and, once one exists, the submission. */
export interface SubmitterAccessTarget extends FormAccessTarget {
  submissionId?: string;
}

/** An operation on an existing submission. */
export type SubmissionOperationCode = Exclude<SubmitterOperationCode, 'open'>;

const SUBMISSION_RULES: Record<
  SubmissionOperationCode,
  (loaded: SubmitterSubmission, caller: CallerIdentity) => boolean
> = {
  read: ({ access }) => canReadSubmission(access),
  write: ({ access, form }, caller) => canWriteSubmission(access, form, caller),
  upload: ({ access, form }, caller) => canUploadSubmissionFile(access, form, caller),
  deleteFile: ({ access, form }, caller) => canDeleteSubmissionFile(access, form, caller),
  render: ({ access, form }, caller) => canRenderSubmission(access, form, caller),
  // The signed-in owner, whatever the state; the delete itself refuses a submitted submission.
  delete: ({ access }, caller) =>
    ownDeleteStatusOf(access, caller).status !== SubmissionChangeStatus.denied,
  // Refused only for the caller; the revise itself refuses a submission already taken up.
  revise: ({ access, form }, caller) =>
    reviseStatusOf(access, form, caller).status !== SubmissionChangeStatus.denied,
};

/** The one read of a submission for the caller; null when it is not live or there is no actor. */
export const findSubmissionForCaller = async (
  submissionId: string,
  caller: CallerIdentity,
): Promise<SubmitterSubmission | null> =>
  caller.actorId
    ? findSubmitterSubmission({ submissionId, actorId: caller.actorId, idpCode: caller.idpCode })
    : null;

/** Whether the read allows the operation, by its @soba/lib rule. */
export const allowsSubmitterOperation = (
  operation: SubmissionOperationCode,
  loaded: SubmitterSubmission,
  caller: CallerIdentity,
): boolean => SUBMISSION_RULES[operation](loaded, caller);

/**
 * Whether the caller may perform a submit-mode operation on the target, by the rules the routes
 * decide with. An operation on a submission needs it, its form and its version live. Open checks the
 * form's submit permission only, not its published version.
 */
export const isSubmitterAllowed = async (
  operation: SubmitterOperationCode,
  target: SubmitterAccessTarget,
  caller: CallerIdentity,
): Promise<boolean> => {
  if (operation === SubmitterOperation.open) {
    return hasFormSubmitAccess(target, caller, Permissions.submission_create);
  }
  if (!target.submissionId) return false;
  const loaded = await findSubmissionForCaller(target.submissionId, caller);
  return !!loaded && allowsSubmitterOperation(operation, loaded, caller);
};
