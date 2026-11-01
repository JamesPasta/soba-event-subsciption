import express, { type RequestHandler } from 'express';
import { asyncHandler } from '../../core/api/shared/asyncHandler';
import { validateRequest } from '../../core/api/shared/validation';
import { Permissions } from '../../core/db/codes';
import { requireFormPermissions } from '../../core/middleware/requireFormPermissions';
import { requireWorkspaceOwner } from '../../core/middleware/requireWorkspaceRole';
import { workspaceFromResource } from '../../core/middleware/workspaceContext';
import {
  formScope,
  getJobHandler,
  listJobFormsHandler,
  listJobsHandler,
  rerunJobHandler,
  stopJobHandler,
  workspaceScope,
  type ScopeOf,
} from './controller';
import {
  JobParamsSchema,
  JobScopeParamsSchema,
  ListFormJobsQuerySchema,
  ListWorkspaceJobsQuerySchema,
} from './schema';

/**
 * GET / lists; GET /:jobId reads one; POST /:jobId/rerun and /:jobId/cancel run it again or stop it.
 * Every request resolves the form or workspace and checks the caller before any job is read.
 */
function jobsRouter(config: {
  gates: RequestHandler[];
  scopeOf: ScopeOf;
  listQuery: typeof ListFormJobsQuerySchema | typeof ListWorkspaceJobsQuerySchema;
  /** GET /forms lists the forms that have jobs, for the list's form filter. */
  listsForms: boolean;
}): express.Router {
  const { gates, scopeOf, listQuery, listsForms } = config;
  const router = express.Router({ mergeParams: true });
  const job = [validateRequest({ params: JobParamsSchema }), ...gates];
  router.get(
    '/',
    validateRequest({ params: JobScopeParamsSchema, query: listQuery }),
    ...gates,
    asyncHandler(listJobsHandler(scopeOf)),
  );
  if (listsForms) {
    // Before /:jobId, which would take "forms" as an id.
    router.get(
      '/forms',
      validateRequest({ params: JobScopeParamsSchema }),
      ...gates,
      asyncHandler(listJobFormsHandler),
    );
  }
  router.get('/:jobId', ...job, asyncHandler(getJobHandler(scopeOf)));
  router.post('/:jobId/rerun', ...job, asyncHandler(rerunJobHandler(scopeOf)));
  router.post('/:jobId/cancel', ...job, asyncHandler(stopJobHandler(scopeOf)));
  return router;
}

/** Mounted at /forms/:id/jobs on the design surface: the form's administrators. */
export const formJobsRouter = jobsRouter({
  gates: [
    workspaceFromResource({ kind: 'form', idFrom: 'paramsId' }),
    requireFormPermissions([Permissions.form_update]),
  ],
  scopeOf: formScope,
  listQuery: ListFormJobsQuerySchema,
  listsForms: false,
});

/** Mounted at /workspaces/:id/jobs: the workspace's owner. */
export const workspaceJobsRouter = jobsRouter({
  gates: [workspaceFromResource({ kind: 'workspace', idFrom: 'paramsId' }), requireWorkspaceOwner],
  scopeOf: workspaceScope,
  listQuery: ListWorkspaceJobsQuerySchema,
  listsForms: true,
});
