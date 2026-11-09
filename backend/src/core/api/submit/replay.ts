import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { canReadSubmission, type OpenSubmissionBody, type SubmissionDataBody } from '@soba/lib';
import {
  SubmissionEventType,
  SubmissionParticipantRole,
  type SubmissionWriteEventCode,
} from '../../db/codes';
import { getSubmissionRevisionById } from '../../db/repos/submissionRepo';
import {
  findSubmitterSubmission,
  type SubmitterSubmission,
} from '../../db/repos/submitterSubmissionRepo';
import { resolveCaller } from '../../middleware/actor';
import { actorIdOf, loadedSubmission } from '../../middleware/formSubmitAccess';
import { decideRecordedWrite, opensSameSubmission } from '../../services/submissionWriteGate';
import { toSubmissionDto, toSubmissionWriteDto } from '../submissions/serviceFactory';

/**
 * Answers a save or submit already recorded under its revision id with where it landed, before the
 * access and drafts guards, so a retry keeps its answer after the form's settings change. Only a
 * caller with a grant on the submission gets one. A revision id recorded by another write is a 409;
 * an unrecorded one goes on to the guards.
 */
const replayRecordedWrite = async (
  req: Request,
  res: Response,
  next: NextFunction,
  eventType: SubmissionWriteEventCode,
): Promise<void> => {
  try {
    const { submission, access } = loadedSubmission(req);
    if (!canReadSubmission(access)) {
      next();
      return;
    }
    const { revisionId, baseRevisionId } = req.body as SubmissionDataBody;
    const recorded = decideRecordedWrite({
      submissionId: submission.id,
      eventType,
      actorId: actorIdOf(req),
      revisionId,
      baseRevisionId,
      recorded: await getSubmissionRevisionById(revisionId),
    });
    if (recorded.kind === 'new') {
      next();
      return;
    }
    res.json(toSubmissionWriteDto({ record: submission, revision: recorded.revision }));
  } catch (error) {
    next(error);
  }
};

export const replayRecordedSave: RequestHandler = (req, res, next) =>
  replayRecordedWrite(req, res, next, SubmissionEventType.saved);

export const replayRecordedSubmit: RequestHandler = (req, res, next) =>
  replayRecordedWrite(req, res, next, SubmissionEventType.submitted);

/** The caller's own open of this id: they own it, on the form and version the body names. */
const isOwnOpen = ({ submission, access }: SubmitterSubmission, body: OpenSubmissionBody) =>
  access.role === SubmissionParticipantRole.owner && opensSameSubmission(submission, body);

/**
 * Answers an open of an id the caller already owns with that submission, before the form's access
 * and published version are checked. Any other request goes on to loadSubmitterForm and
 * requireSubmissionStart.
 */
export const replayRecordedOpen = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const body = req.body as OpenSubmissionBody;
    const loaded = await findSubmitterSubmission({
      submissionId: body.id,
      actorId: actorIdOf(req),
      idpCode: resolveCaller(req).idpCode,
    });
    if (!loaded || !isOwnOpen(loaded, body)) {
      next();
      return;
    }
    res.json(toSubmissionDto(loaded.submission));
  } catch (error) {
    next(error);
  }
};
