import type { SortLocale } from '@soba/lib/sort';
import { sobaFetch } from '@/src/shared/api/sobaFetch';
import { parseJson } from '@/src/shared/api/sobaHelpers';
import { sortLocaleHeaders, sortLocaleRequest } from '@/src/shared/api/sortLocaleRequest';
import { toListRequestQuery, type ListQueryArgs } from '@/src/types/list';
import type {
  AddWorkspaceAccessBody,
  ListWorkspaceAccessResponse,
  WorkspaceAccessInclude,
  WorkspaceAccessMember,
} from '@/src/types/workspaceAccess';

const membersPath = (workspaceId: string) => `/workspaces/${workspaceId}/members`;
const memberPath = (workspaceId: string, membershipId: string) =>
  `${membersPath(workspaceId)}/${membershipId}`;

/** One page of the workspace's members with their groups, searched and sorted by the server. */
export async function listWorkspaceAccess(
  token: string,
  workspaceId: string,
  args: ListQueryArgs & { include: WorkspaceAccessInclude },
): Promise<ListWorkspaceAccessResponse> {
  const response = await sobaFetch(membersPath(workspaceId), {
    token,
    query: { ...toListRequestQuery(args), include: args.include },
    headers: sortLocaleHeaders(args.locale),
  });
  return parseJson(response);
}

export async function getWorkspaceAccess(
  token: string,
  workspaceId: string,
  membershipId: string,
  locale: SortLocale,
): Promise<WorkspaceAccessMember> {
  const response = await sobaFetch(memberPath(workspaceId, membershipId), {
    token,
    ...sortLocaleRequest(locale),
  });
  return parseJson(response);
}

export async function addWorkspaceAccess(
  token: string,
  workspaceId: string,
  body: AddWorkspaceAccessBody,
): Promise<WorkspaceAccessMember> {
  const response = await sobaFetch(membersPath(workspaceId), { token, method: 'POST', json: body });
  return parseJson(response);
}

export async function setWorkspaceAccessGroups(
  token: string,
  workspaceId: string,
  membershipId: string,
  groupIds: string[],
): Promise<WorkspaceAccessMember> {
  const response = await sobaFetch(`${memberPath(workspaceId, membershipId)}/groups`, {
    token,
    method: 'PUT',
    json: { groupIds },
  });
  return parseJson(response);
}

/** A 404 counts as removed, as the other DELETE helpers treat it: the access is gone either way. */
export async function removeWorkspaceAccess(
  token: string,
  workspaceId: string,
  membershipId: string,
): Promise<void> {
  const response = await sobaFetch(memberPath(workspaceId, membershipId), {
    token,
    method: 'DELETE',
  });
  if (!response.ok && response.status !== 404) await parseJson(response);
}
