import type { NextFunction, Request, Response } from 'express';
import { SubmissionChangeStatus, ApiErrorCodes, uploadStatusOf } from '@soba/lib';
import { resolveCaller } from '../../core/middleware/actor';
import { refuseSubmitter, setSubmitContext } from '../../core/middleware/formSubmitAccess';
import { findSubmissionForCaller, SubmitterOperation } from '../../core/services/submitterAccess';
import { ConflictError, NotFoundError, ValidationError } from '../../core/errors';

/**
 * Authorize a file upload from one read of the submission it belongs to, which also gives the
 * workspace. Only an in-progress submission (opened/draft) accepts uploads. Access is decided before
 * state so a caller who may not write can't read the state from a 409. Runs after multer so the
 * multipart `submissionId` field is parsed.
 */
export const requireUploadAccess = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const submissionId = (req.body as { submissionId?: unknown } | undefined)?.submissionId;
    if (typeof submissionId !== 'string' || !submissionId) {
      throw new ValidationError(
        'submissionId is required to upload a file',
        ApiErrorCodes.upload_invalid,
      );
    }
    const caller = resolveCaller(req);
    const loaded = await findSubmissionForCaller(submissionId, caller);
    if (!loaded) {
      throw new NotFoundError('Submission not found', ApiErrorCodes.submission_not_found);
    }
    const { submission, access, form } = loaded;
    const target = { workspaceId: submission.workspaceId, formId: submission.formId, submissionId };
    const change = uploadStatusOf(access, form, caller);
    if (change.status === SubmissionChangeStatus.denied) {
      refuseSubmitter(req, SubmitterOperation.upload, target, change.code);
    }
    setSubmitContext(req, target);
    if (change.status === SubmissionChangeStatus.closed) {
      throw new ConflictError('Submission is not accepting file uploads', change.code);
    }
    next();
  } catch (error) {
    next(error);
  }
};
