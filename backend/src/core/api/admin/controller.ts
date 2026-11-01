import { Response } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import type {
  DocumentGenerationAuditItem,
  FeatureScopeItem,
  ListDocumentGenerationAuditsResponse,
  ListFeatureScopesResponse,
  ListJobsResponse,
  ListJobTypesResponse,
  ListSobaAdminsResponse,
  SobaAdminItem,
} from '@soba/lib';
import { listJobs, type JobScope } from '../../db/repos/jobViewRepo';
import {
  getJobDetail,
  listJobTypes,
  rerunJob,
  stopJob,
  toJobListItem,
} from '../../services/jobViewService';
import {
  listSobaAdmins,
  addDirectSobaAdmin,
  removeDirectSobaAdmin,
  type SobaAdminListRow,
} from '../../db/repos/sobaAdminRepo';
import {
  getFeatureScopeById,
  listFeatureScopes,
  removeFeatureScope,
  upsertFeatureScope,
  type FeatureScopeRecord,
} from '../../db/repos/featureScopeRepo';
import {
  listDocumentGenerationAudits,
  type DocumentGenerationAuditRecord,
} from '../../db/repos/documentGenerationAuditRepo';
import { getFeatureGateCached } from '../../db/repos/featureRepo';
import { findAppUserById } from '../../db/repos/appUserRepo';
import { db } from '../../db/client';
import { appUsers } from '../../db/schema';
import { FeatureAvailability } from '../../db/codes';
import { NotFoundError, ValidationError } from '../../errors';
import { asyncHandler } from '../shared/asyncHandler';
import {
  AddSobaAdminBodySchema,
  FeatureScopeIdParamsSchema,
  JobIdParamsSchema,
  ListFeatureScopesQuerySchema,
  ListDocumentGenerationAuditsQuerySchema,
  ListSobaAdminsQuerySchema,
  UpsertFeatureScopeBodySchema,
  type ListJobsQuery,
} from './schema';
import type { Request } from 'express';

type AddSobaAdminBody = z.infer<typeof AddSobaAdminBodySchema>;
type UpsertFeatureScopeBody = z.infer<typeof UpsertFeatureScopeBodySchema>;
type ListFeatureScopesQuery = z.infer<typeof ListFeatureScopesQuerySchema>;
type ListDocumentGenerationAuditsQuery = z.infer<typeof ListDocumentGenerationAuditsQuerySchema>;
type ListSobaAdminsQuery = z.infer<typeof ListSobaAdminsQuerySchema>;

const toSobaAdminItem = (row: SobaAdminListRow): SobaAdminItem => ({
  userId: row.userId,
  source: row.source,
  identityProviderCode: row.identityProviderCode,
  syncedAt: row.syncedAt != null ? row.syncedAt.toISOString() : null,
  displayLabel: row.displayLabel,
});

const toFeatureScopeItem = (row: FeatureScopeRecord): FeatureScopeItem => ({
  id: row.id,
  featureCode: row.featureCode,
  // Text columns. Every write goes through UpsertFeatureScopeBodySchema, which only allows these.
  scopeType: row.scopeType as FeatureScopeItem['scopeType'],
  scopeId: row.scopeId,
  status: row.status as FeatureScopeItem['status'],
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  createdBy: row.createdBy,
  updatedBy: row.updatedBy,
});

const toDocumentGenerationAuditItem = (
  row: DocumentGenerationAuditRecord,
): DocumentGenerationAuditItem => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
});

export const listSobaAdminsHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as ListSobaAdminsQuery;
  const { items, total } = await listSobaAdmins({
    offset: query.offset,
    limit: query.limit,
    sort: query.sort,
    locale: req.sortLocale!,
    source: query.source,
    q: query.q,
  });
  const body: ListSobaAdminsResponse = {
    items: items.map(toSobaAdminItem),
    page: {
      offset: query.offset,
      limit: query.limit,
      total,
    },
    filters: {
      source: query.source,
      q: query.q,
    },
    sort: query.sort,
  };
  res.json(body);
});

export const addSobaAdminHandler = asyncHandler(
  async (req: Request<unknown, unknown, AddSobaAdminBody>, res: Response) => {
    const body = req.body as AddSobaAdminBody;
    // user_id is a foreign key, so an unknown id would surface as a 500.
    if (!(await findAppUserById(body.userId))) {
      throw new ValidationError(`Unknown user: ${body.userId}`);
    }

    let actorDisplayLabel: string | null = null;
    if (req.actorId) {
      const row = await db
        .select({ displayLabel: appUsers.displayLabel })
        .from(appUsers)
        .where(eq(appUsers.id, req.actorId))
        .limit(1);
      actorDisplayLabel = row[0]?.displayLabel ?? null;
    }
    await addDirectSobaAdmin(body.userId, actorDisplayLabel);
    res.status(204).send();
  },
);

export const removeSobaAdminHandler = asyncHandler(
  async (req: Request<{ userId: string }>, res: Response) => {
    const { userId } = req.params;
    // Only direct grants are removable, so this is also the answer for an IdP-sourced admin.
    const removed = await removeDirectSobaAdmin(userId);
    if (!removed) throw new NotFoundError('Direct SOBA admin not found');
    res.status(204).send();
  },
);

export const upsertFeatureScopeHandler = asyncHandler(
  async (req: Request<unknown, unknown, UpsertFeatureScopeBody>, res: Response) => {
    const body = req.body as UpsertFeatureScopeBody;
    // feature_code is a foreign key, so an unknown code would surface as a 500. A grant on a
    // non-scoped feature is inert (isFeatureAvailable short-circuits before reading grants), so
    // storing one would only mislead.
    const gate = await getFeatureGateCached(body.featureCode, Date.now());
    if (!gate) {
      throw new ValidationError(`Unknown feature code: ${body.featureCode}`);
    }
    if (gate.availability !== FeatureAvailability.scoped) {
      throw new ValidationError(`Feature is not scoped: ${body.featureCode}`);
    }
    await upsertFeatureScope({
      featureCode: body.featureCode,
      scopeType: body.scopeType,
      scopeId: body.scopeId,
      status: body.status,
      updatedBy: req.actorId ?? null,
    });
    res.status(204).send();
  },
);

export const listFeatureScopesHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as ListFeatureScopesQuery;
  const { items, total } = await listFeatureScopes(query);
  const body: ListFeatureScopesResponse = {
    items: items.map(toFeatureScopeItem),
    page: { offset: query.offset, limit: query.limit, total },
    filters: {
      featureCode: query.featureCode,
      scopeType: query.scopeType,
      status: query.status,
    },
    sort: query.sort,
  };
  res.json(body);
});

export const getFeatureScopeHandler = asyncHandler(
  async (req: Request<z.infer<typeof FeatureScopeIdParamsSchema>>, res: Response) => {
    const row = await getFeatureScopeById(req.params.featureScopeId);
    if (!row) throw new NotFoundError('Feature scope not found');
    res.json(toFeatureScopeItem(row));
  },
);

export const removeFeatureScopeHandler = asyncHandler(
  async (req: Request<z.infer<typeof FeatureScopeIdParamsSchema>>, res: Response) => {
    const deleted = await removeFeatureScope(req.params.featureScopeId);
    if (!deleted) throw new NotFoundError('Feature scope not found');
    res.status(204).send();
  },
);

export const listDocumentGenerationAuditsHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const query = req.query as unknown as ListDocumentGenerationAuditsQuery;
    const { items, total } = await listDocumentGenerationAudits({
      workspaceId: query.workspaceId,
      formId: query.formId,
      offset: query.offset,
      limit: query.limit,
      sort: query.sort,
    });
    const body: ListDocumentGenerationAuditsResponse = {
      items: items.map(toDocumentGenerationAuditItem),
      page: { offset: query.offset, limit: query.limit, total },
      filters: { workspaceId: query.workspaceId, formId: query.formId },
      sort: query.sort,
    };
    res.json(body);
  },
);

type JobIdParams = z.infer<typeof JobIdParamsSchema>;

const EVERY_JOB: JobScope = { kind: 'all' };

export const listJobsHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as ListJobsQuery;
  const filters = {
    status: query.status,
    type: query.type,
    workspaceId: query.workspaceId,
    formId: query.formId,
    submissionId: query.submissionId,
  };
  const { items, total } = await listJobs(EVERY_JOB, {
    ...filters,
    offset: query.offset,
    limit: query.limit,
    sort: query.sort,
  });
  const body: ListJobsResponse = {
    items: items.map(toJobListItem),
    page: { offset: query.offset, limit: query.limit, total },
    filters,
    sort: query.sort,
  };
  res.json(body);
});

export const listJobTypesHandler = (_req: Request, res: Response) => {
  const body: ListJobTypesResponse = { items: listJobTypes() };
  res.json(body);
};

export const getJobHandler = asyncHandler(async (req: Request<JobIdParams>, res: Response) => {
  res.json(await getJobDetail(req.params.jobId));
});

export const rerunJobHandler = asyncHandler(async (req: Request<JobIdParams>, res: Response) => {
  await rerunJob(EVERY_JOB, req.params.jobId, req.actorId!);
  res.json(await getJobDetail(req.params.jobId));
});

export const stopJobHandler = asyncHandler(async (req: Request<JobIdParams>, res: Response) => {
  const { stopped } = await stopJob(EVERY_JOB, req.params.jobId, req.actorId!);
  res.status(stopped ? 200 : 202).json(await getJobDetail(req.params.jobId));
});
