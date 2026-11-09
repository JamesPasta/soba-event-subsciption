import {
  canReadSubmission,
  canWriteSubmission,
  isIdentifiedCaller,
  ownDeleteStatusOf,
  reviseStatusOf,
  startStatusOf,
  SubmissionChangeStatus,
  ApiErrorCodes,
  versionSchemaStatusOf,
  type ApiErrorCode,
  type SubmissionChange,
} from '@soba/lib';
import type { CallerIdentity, FormAccessTarget } from '../db/repos/formSubmitAccessRepo';
import {
  findLiveSubmitterForm,
  findSubmitterFormVersion,
  type SubmitterFormListRow,
  type SubmitterFormVersionRow,
} from '../db/repos/submitterFormRepo';
import {
  findSubmitterSubmission,
  type SubmitterSubmission,
} from '../db/repos/submitterSubmissionRepo';
import { PUBLIC_PROVIDER_CODE, PUBLIC_SUBMITTER_LABEL } from '../db/codes';
import { SubmitterOperation, type SubmitterOperationCode } from '../services/submitterAccess';
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError } from '../errors';
import { log } from '../logging';
import { resolveCaller } from './actor';
import type { Request, Response, NextFunction, RequestHandler } from 'express';

/** A denial that distinguishes an authenticated caller (403) from an anonymous one (401). */
export const accessDenial = (req: Request, message: string, code?: ApiErrorCode): Error =>
  req.user ? new ForbiddenError(message, code) : new UnauthorizedError(message, code);

const CHANGE_DENIED = 'Not authorized to change this submission';

const DENIAL_MESSAGES: Record<SubmitterOperationCode, string> = {
  open: 'Not authorized to submit this form',
  read: 'Not authorized to access this submission',
  write: CHANGE_DENIED,
  upload: CHANGE_DENIED,
  deleteFile: CHANGE_DENIED,
  render: 'Not authorized to generate this document',
  delete: 'Not authorized to delete this submission',
  revise: 'Not authorized to revise this submission',
};

/** Logs and throws the refusal: 401 for anonymous, 403 for an authenticated caller. */
export const refuseSubmitter = (
  req: Request,
  operation: SubmitterOperationCode,
  target: { formId?: string; submissionId?: string },
  code: ApiErrorCode,
): never => {
  log.warn(
    {
      operation,
      code,
      formId: target.formId,
      submissionId: target.submissionId,
      actorId: req.actorId,
    },
    'Submit-mode access refused',
  );
  throw accessDenial(req, DENIAL_MESSAGES[operation], code);
};

/**
 * Populate the public-submit req.coreContext for a submit-mode request. Anonymous callers are
 * attributed to the seeded public user, already resolved as req.actorId.
 */
export const setSubmitContext = (req: Request, target: FormAccessTarget): void => {
  // Guaranteed by resolveActorOrPublic upstream; guard so a missing id can't become an empty-string FK.
  if (!req.actorId) {
    throw new Error('setSubmitContext requires a resolved actor');
  }
  req.coreContext = {
    workspaceId: target.workspaceId,
    formId: target.formId,
    actorId: req.actorId,
    actorDisplayLabel:
      req.user?.profile?.displayLabel || req.user?.profile?.displayName || PUBLIC_SUBMITTER_LABEL,
    workspaceSource: 'public-submit',
    // Submit-mode handlers read no role; without one, no workspace role check passes.
    role: null,
  };
};

/** The actor resolveActorOrPublic resolved; every submit route has one. */
export const actorIdOf = (req: Request): string => {
  if (!req.actorId) throw new Error('Submit routes require a resolved actor');
  return req.actorId;
};

/** The user whose form permissions count: none for the public user, which belongs to no workspace. */
const permissionUserId = (actorId: string, caller: CallerIdentity): string | null =>
  caller.idpCode === PUBLIC_PROVIDER_CODE ? null : actorId;

/**
 * Reads the submission named by :id once, with the caller's grant and its form's facts, for the
 * guards and handlers after it. 404 when it, its form or its version is deleted.
 */
export const loadSubmitterSubmission = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const loaded = await findSubmitterSubmission({
      submissionId: req.params.id,
      actorId: actorIdOf(req),
      idpCode: resolveCaller(req).idpCode,
    });
    if (!loaded)
      throw new NotFoundError('Submission not found', ApiErrorCodes.submission_not_found);
    req.submitterSubmission = loaded;
    setSubmitContext(req, {
      workspaceId: loaded.submission.workspaceId,
      formId: loaded.submission.formId,
    });
    next();
  } catch (error) {
    next(error);
  }
};

/** The read loadSubmitterSubmission stored. */
export const loadedSubmission = (req: Request): SubmitterSubmission => {
  if (!req.submitterSubmission) {
    throw new Error('Submit-mode guards and handlers must run after loadSubmitterSubmission');
  }
  return req.submitterSubmission;
};

/** Runs a decision over the loaded read; a refusal is 401 or 403 by caller. */
const decide = (
  req: Request,
  next: NextFunction,
  operation: SubmitterOperationCode,
  code: ApiErrorCode,
  allows: (loaded: SubmitterSubmission, caller: CallerIdentity) => boolean,
): void => {
  try {
    const loaded = loadedSubmission(req);
    if (!allows(loaded, resolveCaller(req))) {
      refuseSubmitter(
        req,
        operation,
        { formId: loaded.submission.formId, submissionId: loaded.submission.id },
        code,
      );
    }
    next();
  } catch (error) {
    next(error);
  }
};

/** Authorizes a read of an existing submission: confirmation, data, schema, fill bundle. */
export const requireSubmissionRead: RequestHandler = (req, _res, next) =>
  decide(req, next, SubmitterOperation.read, ApiErrorCodes.read_denied, ({ access }) =>
    canReadSubmission(access),
  );

/** Authorizes a save or submit. Its state does not refuse it; the write may be kept as pending. */
export const requireSubmissionWrite: RequestHandler = (req, _res, next) =>
  decide(
    req,
    next,
    SubmitterOperation.write,
    ApiErrorCodes.write_denied,
    ({ access, form }, caller) => canWriteSubmission(access, form, caller),
  );

/** Authorizes the owner's delete of their own submission: 409 once it is submitted. */
export const requireSubmissionDelete: RequestHandler = (req, _res, next) => {
  try {
    const { submission, access } = loadedSubmission(req);
    const change = ownDeleteStatusOf(access, resolveCaller(req));
    if (change.status === SubmissionChangeStatus.denied) {
      refuseSubmitter(
        req,
        SubmitterOperation.delete,
        { formId: submission.formId, submissionId: submission.id },
        change.code,
      );
    }
    if (change.status === SubmissionChangeStatus.closed) {
      throw new ConflictError(
        `Submission is ${submission.workflowState} and can no longer be deleted`,
        change.code,
      );
    }
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Authorizes the owner's revise of their own submission. Only a refusal of the caller stops it
 * here; whether the submission can still be revised is decided under its lock, so a retry of a
 * revise already made is answered as made.
 */
export const requireSubmissionRevise: RequestHandler = (req, _res, next) => {
  try {
    const { submission, access, form } = loadedSubmission(req);
    const change = reviseStatusOf(access, form, resolveCaller(req));
    if (change.status === SubmissionChangeStatus.denied) {
      refuseSubmitter(
        req,
        SubmitterOperation.revise,
        { formId: submission.formId, submissionId: submission.id },
        change.code,
      );
    }
    next();
  } catch (error) {
    next(error);
  }
};

/** Stores the form read for the guards and handlers after it. */
const storeForm = (req: Request, form: SubmitterFormListRow): void => {
  req.submitterForm = form;
  setSubmitContext(req, { workspaceId: form.workspaceId, formId: form.id });
};

/**
 * Reads the form named by :formId, or by the body on POST /submissions, once, with its facts for
 * the caller. 404 when it is missing or deleted.
 */
export const loadSubmitterForm = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const formId = req.params.formId ?? (req.body as { formId: string }).formId;
    const caller = resolveCaller(req);
    const form = await findLiveSubmitterForm({
      userId: permissionUserId(actorIdOf(req), caller),
      formId,
    });
    if (!form) throw new NotFoundError('Form not found', ApiErrorCodes.form_not_found);
    storeForm(req, form);
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Reads the form version named by :id once, with its form and the form's facts for the caller.
 * 404 when it or its form is missing or deleted.
 */
export const loadSubmitterFormVersion = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const caller = resolveCaller(req);
    const loaded = await findSubmitterFormVersion({
      userId: permissionUserId(actorIdOf(req), caller),
      formVersionId: req.params.id,
    });
    if (!loaded) {
      throw new NotFoundError('Form version schema not found', ApiErrorCodes.schema_not_found);
    }
    req.submitterFormVersion = loaded.version;
    storeForm(req, loaded.form);
    next();
  } catch (error) {
    next(error);
  }
};

/** The form loadSubmitterForm or loadSubmitterFormVersion stored. */
export const loadedForm = (req: Request): SubmitterFormListRow => {
  if (!req.submitterForm) {
    throw new Error('Submit-mode form guards and handlers must run after a form load');
  }
  return req.submitterForm;
};

/** The form version loadSubmitterFormVersion stored. */
export const loadedFormVersion = (req: Request): SubmitterFormVersionRow => {
  if (!req.submitterFormVersion) {
    throw new Error('Submit-mode version handlers must run after loadSubmitterFormVersion');
  }
  return req.submitterFormVersion;
};

/**
 * Throws the refusal of a start on the form: 401/403 when the caller may not start, 404 when it has
 * no published version, 409 when a read names a version that is not the published one.
 */
const refuseStart = (req: Request, form: SubmitterFormListRow, change: SubmissionChange): void => {
  if (change.status === SubmissionChangeStatus.denied) {
    refuseSubmitter(req, SubmitterOperation.open, { formId: form.id }, change.code);
  }
  if (change.status !== SubmissionChangeStatus.closed) return;
  if (change.code === ApiErrorCodes.version_not_published) {
    throw new ConflictError('Form version is not the published version', change.code);
  }
  throw new NotFoundError('Form has no published version', change.code);
};

/** Authorizes starting a submission on the loaded form: opening one, or reading the form for it. */
export const requireSubmissionStart: RequestHandler = (req, _res, next) => {
  try {
    const form = loadedForm(req);
    refuseStart(req, form, startStatusOf(form, resolveCaller(req)));
    next();
  } catch (error) {
    next(error);
  }
};

/** Authorizes a read of the loaded version's schema: a start, on the published version. */
export const requireVersionSchemaRead: RequestHandler = (req, _res, next) => {
  try {
    const form = loadedForm(req);
    const change = versionSchemaStatusOf(loadedFormVersion(req).id, form, resolveCaller(req));
    refuseStart(req, form, change);
    next();
  } catch (error) {
    next(error);
  }
};

/** Authorizes a list of the caller's own forms or submissions: signed-in only, otherwise 401. */
export const requireSignedInSubmitter = (
  req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  if (isIdentifiedCaller(resolveCaller(req))) {
    next();
    return;
  }
  next(
    accessDenial(
      req,
      'Sign in to list your own forms and submissions',
      ApiErrorCodes.sign_in_required,
    ),
  );
};
