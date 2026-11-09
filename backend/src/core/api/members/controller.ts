import { Response } from 'express';
import { z } from 'zod';
import { membersApiService } from './service';
import { asyncHandler } from '../shared/asyncHandler';
import type { Request } from 'express';
import { ListMembersQuerySchema } from './schema';

type ListMembersQuery = z.infer<typeof ListMembersQuerySchema>;

export const listMembers = asyncHandler(async (req: Request, res: Response) => {
  const ctx = req.coreContext!;
  const result = await membersApiService.list(ctx.workspaceId, {
    ...(req.query as unknown as ListMembersQuery),
    locale: req.sortLocale!,
  });
  res.json(result);
});
