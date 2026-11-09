import type { NextFunction, Request, Response } from 'express';
import {
  draftSaveStatusOf,
  DraftSaveStatus,
  ApiErrorCodes,
  type DraftSaveStatusCode,
  type ApiErrorCode,
} from '@soba/lib';
import { loadedSubmission } from '../../middleware/formSubmitAccess';
import { ForbiddenError } from '../../errors';
import { log } from '../../logging';

const REFUSALS: Record<
  Exclude<DraftSaveStatusCode, 'allowed'>,
  { message: string; code: ApiErrorCode }
> = {
  disabled: {
    message: 'Drafts are not enabled for this form',
    code: ApiErrorCodes.drafts_disabled,
  },
  public: {
    message: 'Drafts are not available on a public form',
    code: ApiErrorCodes.drafts_public,
  },
};

/** Refuses a save when the form does not accept drafts. Runs after requireSubmissionWrite. */
export const requireDraftSave = (req: Request, _res: Response, next: NextFunction): void => {
  try {
    const { submission, form } = loadedSubmission(req);
    const status = draftSaveStatusOf(form);
    if (status !== DraftSaveStatus.allowed) {
      log.warn(
        {
          formId: submission.formId,
          submissionId: submission.id,
          actorId: req.actorId,
          reason: status,
        },
        'Draft save refused',
      );
      throw new ForbiddenError(REFUSALS[status].message, REFUSALS[status].code);
    }
    next();
  } catch (error) {
    next(error);
  }
};
