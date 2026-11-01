import { type SortLocale, type WorkspaceAccessInclude } from '@soba/lib';
import { NotFoundError } from '../../errors';
import { WorkspaceMembershipRole } from '../../db/codes';
import { MEMBER_NOT_FOUND } from '../../messages';
import {
  addWorkspaceAccess,
  getWorkspaceAccess,
  listWorkspaceAccess,
  removeWorkspaceAccess,
  setWorkspaceAccessGroups,
  type WorkspaceAccessRow,
  type WorkspaceAccessSort,
} from '../../db/repos/workspaceAccessRepo';

export interface AccessContextInput {
  workspaceId: string;
  actorId: string;
  actorDisplayLabel: string | null;
  locale: SortLocale;
}

async function loadMember(
  ctx: AccessContextInput,
  membershipId: string,
): Promise<WorkspaceAccessRow> {
  const member = await getWorkspaceAccess(ctx.workspaceId, membershipId, ctx.locale);
  if (!member) {
    throw new NotFoundError(MEMBER_NOT_FOUND);
  }
  return member;
}

export class AccessApiService {
  async list(
    ctx: AccessContextInput,
    query: {
      offset: number;
      limit: number;
      sort: WorkspaceAccessSort;
      include: WorkspaceAccessInclude;
      q?: string;
    },
  ) {
    const { items, total } = await listWorkspaceAccess({
      workspaceId: ctx.workspaceId,
      offset: query.offset,
      limit: query.limit,
      sort: query.sort,
      locale: ctx.locale,
      include: query.include,
      q: query.q,
    });
    return {
      items,
      page: { offset: query.offset, limit: query.limit, total },
      filters: { q: query.q, include: query.include },
      sort: query.sort,
    };
  }

  get(ctx: AccessContextInput, membershipId: string) {
    return loadMember(ctx, membershipId);
  }

  /** New members join as viewers: what they may do on forms comes from their groups. */
  async add(ctx: AccessContextInput, input: { userId: string; groupIds: string[] }) {
    const membershipId = await addWorkspaceAccess({
      workspaceId: ctx.workspaceId,
      userId: input.userId,
      groupIds: input.groupIds,
      role: WorkspaceMembershipRole.viewer,
      actorId: ctx.actorId,
      displayLabel: ctx.actorDisplayLabel,
    });
    return loadMember(ctx, membershipId);
  }

  async setGroups(ctx: AccessContextInput, membershipId: string, groupIds: string[]) {
    await setWorkspaceAccessGroups({
      workspaceId: ctx.workspaceId,
      membershipId,
      groupIds,
      displayLabel: ctx.actorDisplayLabel,
    });
    return loadMember(ctx, membershipId);
  }

  remove(ctx: AccessContextInput, membershipId: string) {
    return removeWorkspaceAccess({
      workspaceId: ctx.workspaceId,
      membershipId,
      actorId: ctx.actorId,
      displayLabel: ctx.actorDisplayLabel,
    });
  }
}

export const accessApiService = new AccessApiService();
