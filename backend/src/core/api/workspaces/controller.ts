import { Response } from 'express';
import { z } from 'zod';
import { workspacesApiService } from './service';
import { asyncHandler } from '../shared/asyncHandler';
import { NotFoundError, ValidationError } from '../../errors';
import { getActorId, getActorIdpCode } from '../../middleware/actor';
import type { Request } from 'express';
import {
  ListWorkspacesQuerySchema,
  CreateWorkspaceBodySchema,
  UpdateWorkspaceBodySchema,
  WorkspaceIdParamsSchema,
  WorkspaceLookupQuerySchema,
  WorkspaceNameAvailabilityQuerySchema,
} from './schema';

type ListWorkspacesQuery = z.infer<typeof ListWorkspacesQuerySchema>;
type WorkspaceLookupQuery = z.infer<typeof WorkspaceLookupQuerySchema>;
type CreateWorkspaceBody = z.infer<typeof CreateWorkspaceBodySchema>;
type UpdateWorkspaceBody = z.infer<typeof UpdateWorkspaceBodySchema>;
type WorkspaceIdParams = z.infer<typeof WorkspaceIdParamsSchema>;
type WorkspaceNameAvailabilityQuery = z.infer<typeof WorkspaceNameAvailabilityQuerySchema>;

const MISSING_ACTOR_IDENTITY = 'Missing actor identity';

export const listWorkspaces = asyncHandler(async (req: Request, res: Response) => {
  const actorId = getActorId(req);
  if (!actorId) {
    throw new ValidationError(MISSING_ACTOR_IDENTITY);
  }
  const result = await workspacesApiService.list(actorId, {
    ...(req.query as unknown as ListWorkspacesQuery),
    locale: req.sortLocale!,
  });
  res.json(result);
});

export const lookupWorkspaces = asyncHandler(async (req: Request, res: Response) => {
  const actorId = getActorId(req);
  if (!actorId) {
    throw new ValidationError(MISSING_ACTOR_IDENTITY);
  }
  const result = await workspacesApiService.lookup(actorId, {
    ...(req.query as unknown as WorkspaceLookupQuery),
    locale: req.sortLocale!,
  });
  res.json(result);
});

export const createWorkspace = asyncHandler(async (req: Request, res: Response) => {
  const actorId = getActorId(req);
  if (!actorId) {
    throw new ValidationError(MISSING_ACTOR_IDENTITY);
  }
  const result = await workspacesApiService.create(
    actorId,
    getActorIdpCode(req),
    req.body as CreateWorkspaceBody,
  );
  res.status(201).json(result);
});

export const checkWorkspaceNameAvailable = asyncHandler(async (req: Request, res: Response) => {
  const actorId = getActorId(req);
  if (!actorId) {
    throw new ValidationError(MISSING_ACTOR_IDENTITY);
  }
  const { org, name, excludeId } = req.query as unknown as WorkspaceNameAvailabilityQuery;
  const result = await workspacesApiService.checkNameAvailable(
    actorId,
    getActorIdpCode(req),
    org,
    name,
    excludeId,
  );
  res.json(result);
});

export const getCurrentWorkspace = asyncHandler(async (req: Request, res: Response) => {
  const ctx = req.coreContext!;
  const result = await workspacesApiService.getCurrent(ctx.workspaceId, ctx.actorId);
  if (!result) {
    throw new NotFoundError('Current workspace not found');
  }
  res.json(result);
});

export const getWorkspaceById = asyncHandler(async (req: Request, res: Response) => {
  const ctx = req.coreContext!;
  const result = await workspacesApiService.getCurrent(ctx.workspaceId, ctx.actorId);
  if (!result) {
    throw new NotFoundError('Workspace not found');
  }
  res.json(result);
});

export const updateWorkspace = asyncHandler(
  async (req: Request<WorkspaceIdParams, unknown, UpdateWorkspaceBody>, res: Response) => {
    const ctx = req.coreContext!;
    const result = await workspacesApiService.update(ctx.workspaceId, ctx.actorId, req.body);
    if (!result) {
      throw new NotFoundError('Workspace not found');
    }
    res.json(result);
  },
);
