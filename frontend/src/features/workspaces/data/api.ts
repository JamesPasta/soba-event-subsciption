import type { SortLocale } from '@soba/lib/sort';
import { sobaFetch } from '@/src/shared/api/sobaFetch';
import { parseJson } from '@/src/shared/api/sobaHelpers';
import { sortLocaleHeaders, sortLocaleRequest } from '@/src/shared/api/sortLocaleRequest';
import { toListRequestQuery, type ListQueryArgs } from '@/src/types/list';
import type {
  CreateWorkspaceGroupBody,
  ListWorkspaceGroupsResponse,
  UpdateWorkspaceGroupBody,
  WorkspaceGroup,
} from '@/src/types/workspaceGroups';
import type {
  CreateWorkspaceRoleBody,
  ListWorkspaceRolesResponse,
  UpdateWorkspaceRoleBody,
  WorkspaceRole,
} from '@/src/types/workspaceRoles';

const groupsPath = (workspaceId: string) => `/workspaces/${workspaceId}/groups`;
const groupPath = (workspaceId: string, groupId: string) => `${groupsPath(workspaceId)}/${groupId}`;

const rolesPath = (workspaceId: string) => `/workspaces/${workspaceId}/roles`;
const rolePath = (workspaceId: string, roleCode: string) => `${rolesPath(workspaceId)}/${roleCode}`;

/** Every role available in the workspace, with its permission codes. */
export async function listWorkspaceRoles(
  token: string,
  workspaceId: string,
): Promise<ListWorkspaceRolesResponse> {
  const response = await sobaFetch(rolesPath(workspaceId), { token });
  return parseJson(response);
}

export async function getWorkspaceRole(
  token: string,
  workspaceId: string,
  roleCode: string,
): Promise<WorkspaceRole> {
  const response = await sobaFetch(rolePath(workspaceId, roleCode), { token });
  return parseJson(response);
}

export async function createWorkspaceRole(
  token: string,
  workspaceId: string,
  body: CreateWorkspaceRoleBody,
): Promise<WorkspaceRole> {
  const response = await sobaFetch(rolesPath(workspaceId), { token, method: 'POST', json: body });
  return parseJson(response);
}

export async function updateWorkspaceRole(
  token: string,
  workspaceId: string,
  roleCode: string,
  body: UpdateWorkspaceRoleBody,
): Promise<WorkspaceRole> {
  const response = await sobaFetch(rolePath(workspaceId, roleCode), {
    token,
    method: 'PATCH',
    json: body,
  });
  return parseJson(response);
}

/** A 404 counts as deleted, as the other DELETE helpers treat it: the row is gone either way. */
export async function deleteWorkspaceRole(
  token: string,
  workspaceId: string,
  roleCode: string,
): Promise<void> {
  const response = await sobaFetch(rolePath(workspaceId, roleCode), { token, method: 'DELETE' });
  if (!response.ok && response.status !== 404) await parseJson(response);
}

/** One page of the workspace's groups, searched and sorted by the server. */
export async function listWorkspaceGroups(
  token: string,
  workspaceId: string,
  args: ListQueryArgs,
): Promise<ListWorkspaceGroupsResponse> {
  const response = await sobaFetch(groupsPath(workspaceId), {
    token,
    query: toListRequestQuery(args),
    headers: sortLocaleHeaders(args.locale),
  });
  return parseJson(response);
}

export async function getWorkspaceGroup(
  token: string,
  workspaceId: string,
  groupId: string,
  locale: SortLocale,
): Promise<WorkspaceGroup> {
  const response = await sobaFetch(groupPath(workspaceId, groupId), {
    token,
    ...sortLocaleRequest(locale),
  });
  return parseJson(response);
}

export async function createWorkspaceGroup(
  token: string,
  workspaceId: string,
  body: CreateWorkspaceGroupBody,
): Promise<WorkspaceGroup> {
  const response = await sobaFetch(groupsPath(workspaceId), { token, method: 'POST', json: body });
  return parseJson(response);
}

export async function renameWorkspaceGroup(
  token: string,
  workspaceId: string,
  groupId: string,
  body: UpdateWorkspaceGroupBody,
): Promise<WorkspaceGroup> {
  const response = await sobaFetch(groupPath(workspaceId, groupId), {
    token,
    method: 'PATCH',
    json: body,
  });
  return parseJson(response);
}

export async function setWorkspaceGroupRoles(
  token: string,
  workspaceId: string,
  groupId: string,
  roleCodes: string[],
): Promise<WorkspaceGroup> {
  const response = await sobaFetch(`${groupPath(workspaceId, groupId)}/roles`, {
    token,
    method: 'PUT',
    json: { roleCodes },
  });
  return parseJson(response);
}

/** A 404 counts as deleted, as the other DELETE helpers treat it: the row is gone either way. */
export async function deleteWorkspaceGroup(
  token: string,
  workspaceId: string,
  groupId: string,
): Promise<void> {
  const response = await sobaFetch(groupPath(workspaceId, groupId), { token, method: 'DELETE' });
  if (!response.ok && response.status !== 404) await parseJson(response);
}
