import type { Request, Response } from 'express';
import { asyncHandler } from '../shared/asyncHandler';
import { rolesApiService } from './service';

export const listWorkspaceRoles = asyncHandler(async (req: Request, res: Response) => {
  res.json(await rolesApiService.list(req.coreContext!.workspaceId));
});
