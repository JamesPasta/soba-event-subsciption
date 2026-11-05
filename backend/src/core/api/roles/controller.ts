import type { Request, Response } from 'express';
import type { z } from 'zod';
import { asyncHandler } from '../shared/asyncHandler';
import { rolesApiService } from './service';
import type { CreateRoleBodySchema, RoleCodeParamsSchema, UpdateRoleBodySchema } from './schema';

type RoleCodeParams = z.infer<typeof RoleCodeParamsSchema>;
type CreateRoleBody = z.infer<typeof CreateRoleBodySchema>;
type UpdateRoleBody = z.infer<typeof UpdateRoleBodySchema>;

export const listWorkspaceRoles = asyncHandler(async (req: Request, res: Response) => {
  res.json(await rolesApiService.list(req.coreContext!.workspaceId));
});

export const getWorkspaceRole = asyncHandler(
  async (req: Request<RoleCodeParams>, res: Response) => {
    res.json(await rolesApiService.get(req.coreContext!.workspaceId, req.params.roleCode));
  },
);

export const createWorkspaceRole = asyncHandler(
  async (req: Request<unknown, unknown, CreateRoleBody>, res: Response) => {
    res.status(201).json(await rolesApiService.create(req.coreContext!, req.body));
  },
);

export const updateWorkspaceRole = asyncHandler(
  async (req: Request<RoleCodeParams, unknown, UpdateRoleBody>, res: Response) => {
    res.json(await rolesApiService.update(req.coreContext!, req.params.roleCode, req.body));
  },
);

export const deleteWorkspaceRole = asyncHandler(
  async (req: Request<RoleCodeParams>, res: Response) => {
    await rolesApiService.remove(req.coreContext!, req.params.roleCode);
    res.status(204).send();
  },
);
