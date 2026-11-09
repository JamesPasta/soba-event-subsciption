import { Response } from 'express';
import { z } from 'zod';
import {
  ApiErrorCodes,
  canContinueSubmission,
  type MySubmissionRole,
  type ReviseSubmissionBody,
  type SubmitFillBundle,
  type SubmitFormVersionSchemaResponse,
} from '@soba/lib';
import { asyncHandler } from '../shared/asyncHandler';
import { NotFoundError } from '../../errors';
import { formsApiService, formVersionService, submissionsApiService } from '../../container';
import type { SubmitterSubmissionRow } from '../../db/repos/submitterSubmissionRepo';
import { resolveCaller } from '../../middleware/actor';
import { loadedForm, loadedFormVersion, loadedSubmission } from '../../middleware/formSubmitAccess';
import { toSubmitterFormDto } from '../forms/serviceFactory';
import { toSubmissionDto } from '../submissions/serviceFactory';
import { submissionReviewService } from '../submissions/reviewService';
import { workspacesApiService } from '../workspaces/service';
import type { Request, RequestHandler } from 'express';
import { ListMyFormsQuerySchema, ListMySubmissionsQuerySchema } from './schema';

type ListMySubmissionsQuery = z.infer<typeof ListMySubmissionsQuerySchema>;
type ListMyFormsQuery = z.infer<typeof ListMyFormsQuerySchema>;

/** The schema of a form version in its engine, or 404. */
const readVersionSchema = async (version: {
  formEngineCode: string;
  engineSchemaRef: string | null;
}) => {
  const schema = await formVersionService.readSchema({
    engineCode: version.formEngineCode,
    engineSchemaRef: version.engineSchemaRef,
  });
  if (!schema)
    throw new NotFoundError('Form version schema not found', ApiErrorCodes.schema_not_found);
  return schema;
};

/** The submission's saved answers; null before its first write. */
const readContent = (submission: SubmitterSubmissionRow) =>
  submissionsApiService.readContent({
    engineCode: submission.formEngineCode,
    engineSchemaRef: submission.engineSchemaRef,
    engineSubmissionRef: submission.engineSubmissionRef,
  });

/**
 * The owner sends their own submission back to revise; answers with the submission as it now
 * stands. Runs after requireSubmissionRevise.
 */
export const reviseOwnSubmission = asyncHandler(
  async (req: Request<{ id: string }, unknown, ReviseSubmissionBody>, res: Response) => {
    const { submission } = loadedSubmission(req);
    const ctx = req.coreContext!;
    await submissionReviewService.reviseOwn(
      { ...ctx, submissionId: submission.id, fromStatusId: submission.statusId },
      req.body,
    );
    const revised = await submissionsApiService.get(ctx, submission.id);
    if (!revised)
      throw new NotFoundError('Submission not found', ApiErrorCodes.submission_not_found);
    res.json(revised);
  },
);

export const getSubmitSubmission: RequestHandler = (req, res) => {
  const { submission, access, form } = loadedSubmission(req);
  res.json({
    ...toSubmissionDto(submission),
    reviewLabel: access.reviewStatus,
    canContinue: canContinueSubmission(access, form, resolveCaller(req)),
  });
};

export const getSubmitSubmissionData = asyncHandler(async (req: Request, res: Response) => {
  const content = await readContent(loadedSubmission(req).submission);
  if (!content)
    throw new NotFoundError('Submission content not found', ApiErrorCodes.content_not_found);
  res.json(content);
});

/**
 * The schema for a submission's confirmation view: the schema of that submission's own form version,
 * whatever its state, since an older submission may reference a since-archived version. No arbitrary
 * version is reachable by UUID.
 */
export const getSubmitSubmissionSchema = asyncHandler(async (req: Request, res: Response) => {
  res.json(await readVersionSchema(loadedSubmission(req).submission));
});

/**
 * The one payload the fill page needs for an in-progress submission: its workflow state, form
 * version and schema, head revision (the base for the next write), any saved answers, the caller's
 * role, and the form with its facts, from one read. `content` is null for a just-`opened` submission
 * (no engine document yet), so the client renders an empty form without a second, 404-ing data call.
 */
export const getSubmitFillBundle = asyncHandler(async (req: Request, res: Response) => {
  const { submission, access, form } = loadedSubmission(req);
  // Schema first: a missing schema is a 404 whatever the content read would do.
  const schema = await readVersionSchema(submission);
  const content = await readContent(submission);
  const bundle: SubmitFillBundle = {
    formId: submission.formId,
    workflowState: submission.workflowState,
    formVersionId: submission.formVersionId,
    headRevisionId: submission.headRevisionId,
    currentRevisionNo: submission.currentRevisionNo,
    // The read guard refuses a caller without a grant, and the database holds only these roles.
    role: access.role as MySubmissionRole,
    form: toSubmitterFormDto(form),
    schema,
    content: content ?? null,
  };
  res.json(bundle);
});

/** The form with its facts for the caller. Runs after requireSubmissionStart. */
export const getSubmitForm: RequestHandler = (req, res) => {
  res.json(toSubmitterFormDto(loadedForm(req)));
};

/** The published version's schema to start from. Runs after requireVersionSchemaRead. */
export const getSubmitFormVersionSchema = asyncHandler(async (req: Request, res: Response) => {
  const version = loadedFormVersion(req);
  const schema = await readVersionSchema(version);
  const body: SubmitFormVersionSchemaResponse = {
    formId: version.formId,
    formVersionId: version.id,
    versionNo: version.versionNo,
    schema,
    schemaHash: formVersionService.schemaHash({ engineCode: version.formEngineCode, schema }),
  };
  res.json(body);
});

/** The caller's own draft and submitted submissions. Runs after requireSignedInSubmitter. */
export const listMySubmissions = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as ListMySubmissionsQuery;
  res.json(
    await submissionsApiService.listMine(req.actorId!, {
      offset: query.offset,
      limit: query.limit,
      workflowState: query.workflowState,
      q: query.q,
      sort: query.sort,
      locale: req.sortLocale!,
    }),
  );
});

/** The caller's forms. Runs after requireSignedInSubmitter. */
export const listMyForms = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as ListMyFormsQuery;
  res.json(
    await formsApiService.listMine(req.actorId!, {
      offset: query.offset,
      limit: query.limit,
      workspaceId: query.workspaceId,
      q: query.q,
      sort: query.sort,
      locale: req.sortLocale!,
    }),
  );
});

/** The workspaces the caller's forms belong to. Runs after requireSignedInSubmitter. */
export const listMyWorkspaces = asyncHandler(async (req: Request, res: Response) => {
  res.json(await workspacesApiService.listMine(req.actorId!, req.sortLocale!));
});
