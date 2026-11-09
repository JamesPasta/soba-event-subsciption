import type { SortLocale } from '@soba/lib';
import { listMembersForWorkspace, type MemberListSort } from '../../db/repos/membershipRepo';

export class MembersApiService {
  async list(
    workspaceId: string,
    query: {
      offset: number;
      limit: number;
      role?: string;
      status?: string;
      q?: string;
      sort: MemberListSort;
      locale: SortLocale;
    },
  ) {
    const { items, total } = await listMembersForWorkspace({
      workspaceId,
      offset: query.offset,
      limit: query.limit,
      sort: query.sort,
      locale: query.locale,
      role: query.role,
      status: query.status,
      q: query.q,
    });
    return {
      items: items.map((r) => ({
        id: r.id,
        userId: r.userId,
        displayLabel: r.displayLabel,
        role: r.role,
        status: r.status,
      })),
      page: {
        offset: query.offset,
        limit: query.limit,
        total,
      },
      filters: {
        workspaceId,
        role: query.role,
        status: query.status,
        q: query.q,
      },
      sort: query.sort,
    };
  }
}

export const membersApiService = new MembersApiService();
