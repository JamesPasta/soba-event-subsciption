import type { Request, Response } from 'express';
import type { AddSubmissionNoteBody, UpdateSubmissionStatusBody } from '@soba/lib';
import { asyncHandler } from '../shared/asyncHandler';
import { submissionReviewService } from './reviewService';

type SubmissionIdParams = { id: string };

export const getSubmissionReview = asyncHandler(
  async (req: Request<SubmissionIdParams>, res: Response) => {
    res.json(await submissionReviewService.get(req.coreContext!, req.params.id));
  },
);

export const addSubmissionNote = asyncHandler(
  async (req: Request<SubmissionIdParams, unknown, AddSubmissionNoteBody>, res: Response) => {
    res.json(await submissionReviewService.addNote(req.coreContext!, req.params.id, req.body));
  },
);

export const updateSubmissionStatus = asyncHandler(
  async (req: Request<SubmissionIdParams, unknown, UpdateSubmissionStatusBody>, res: Response) => {
    res.json(await submissionReviewService.updateStatus(req.coreContext!, req.params.id, req.body));
  },
);

export const listSubmissionReviewers = asyncHandler(
  async (req: Request<SubmissionIdParams>, res: Response) => {
    res.json(await submissionReviewService.listReviewers(req.coreContext!));
  },
);
