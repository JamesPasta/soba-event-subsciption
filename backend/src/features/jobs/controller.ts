import type { Request, Response } from 'express';
import type { ListJobFormsResponse, ListStaffJobsResponse } from '@soba/lib';
import { listJobForms, listJobs, type JobScope } from '../../core/db/repos/jobViewRepo';
import {
  getStaffJobDetail,
  rerunJob,
  stopJob,
  toStaffJobListItem,
} from '../../core/services/jobViewService';
import type { ListWorkspaceJobsQuery } from './schema';

type JobParams = { id: string; jobId: string };

/** Reads the scope from the resolved form or workspace, never from the request. */
export type ScopeOf = (req: Request) => JobScope;

export const formScope: ScopeOf = (req) => ({ kind: 'form', formId: req.coreContext!.formId! });

export const workspaceScope: ScopeOf = (req) => ({
  kind: 'workspace',
  workspaceId: req.coreContext!.workspaceId,
});

export const listJobsHandler =
  (scopeOf: ScopeOf) =>
  async (req: Request, res: Response): Promise<void> => {
    // Named fields only: the raw query is merged into the parsed one. Only a workspace list takes a
    // form.
    const query = req.query as unknown as ListWorkspaceJobsQuery;
    const scope = scopeOf(req);
    const filters = {
      status: query.status,
      type: query.type,
      formId: scope.kind === 'workspace' ? query.formId : undefined,
    };
    const { items, total } = await listJobs(scope, {
      ...filters,
      offset: query.offset,
      limit: query.limit,
      sort: query.sort,
    });
    const body: ListStaffJobsResponse = {
      items: items.map(toStaffJobListItem),
      page: { offset: query.offset, limit: query.limit, total },
      filters,
      sort: query.sort,
    };
    res.json(body);
  };

export const listJobFormsHandler = async (req: Request, res: Response): Promise<void> => {
  const body: ListJobFormsResponse = { items: await listJobForms(workspaceScope(req)) };
  res.json(body);
};

export const getJobHandler =
  (scopeOf: ScopeOf) =>
  async (req: Request<JobParams>, res: Response): Promise<void> => {
    res.json(await getStaffJobDetail(scopeOf(req), req.params.jobId));
  };

export const rerunJobHandler =
  (scopeOf: ScopeOf) =>
  async (req: Request<JobParams>, res: Response): Promise<void> => {
    const scope = scopeOf(req);
    await rerunJob(scope, req.params.jobId, req.actorId!);
    res.json(await getStaffJobDetail(scope, req.params.jobId));
  };

export const stopJobHandler =
  (scopeOf: ScopeOf) =>
  async (req: Request<JobParams>, res: Response): Promise<void> => {
    const scope = scopeOf(req);
    const { stopped } = await stopJob(scope, req.params.jobId, req.actorId!);
    res.status(stopped ? 200 : 202).json(await getStaffJobDetail(scope, req.params.jobId));
  };
