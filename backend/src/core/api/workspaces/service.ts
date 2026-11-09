import type { SortLocale } from '@soba/lib';
import {
  getWorkspaceForUser,
  isWorkspaceManageRole,
  listWorkspacesForUser,
  lookupWorkspacesForUser,
  type WorkspaceListSort,
} from '../../db/repos/membershipRepo';
import { canCreateWorkspaceByIdp } from '../../db/repos/idpGroupRepo';
import {
  createTeamWorkspace,
  updateWorkspace,
  workspaceNameExistsForKindAndOrg,
} from '../../db/repos/workspaceRepo';
import { listWorkspacesForSubmitter } from '../../db/repos/submitterFormRepo';
import { WorkspaceKind } from '../../db/codes';
import { ForbiddenError } from '../../errors';
import { WORKSPACE_CREATE_FORBIDDEN, WORKSPACE_MANAGE_FORBIDDEN } from '../../messages';
import { LOOKUP_FETCH_LIMIT, toLookupResponse } from '../shared/lookup';

export class WorkspacesApiService {
  async list(
    actorId: string,
    query: {
      offset: number;
      limit: number;
      kind?: string;
      status?: string;
      q?: string;
      requiredPermission?: string;
      sort: WorkspaceListSort;
      locale: SortLocale;
    },
  ) {
    const { items, total } = await listWorkspacesForUser({
      userId: actorId,
      offset: query.offset,
      limit: query.limit,
      sort: query.sort,
      locale: query.locale,
      kind: query.kind,
      status: query.status,
      q: query.q,
      requiredPermissions: query.requiredPermission ? [query.requiredPermission] : undefined,
    });
    return {
      items: items.map((r) => ({
        id: r.id,
        name: r.name,
        kind: r.kind,
        role: r.role,
        status: r.status,
        org: r.org,
        useCase: r.useCase,
        disclaimerAccepted: r.disclaimerAcceptedAt != null,
      })),
      page: {
        offset: query.offset,
        limit: query.limit,
        total,
      },
      filters: {
        kind: query.kind,
        status: query.status,
        q: query.q,
        requiredPermission: query.requiredPermission,
      },
      sort: query.sort,
    };
  }

  async lookup(
    actorId: string,
    query: {
      q?: string;
      requiredPermissions?: string;
      disclaimerAccepted?: 'true' | 'false';
      locale: SortLocale;
    },
  ) {
    const rows = await lookupWorkspacesForUser({
      userId: actorId,
      q: query.q,
      requiredPermissions: query.requiredPermissions?.split(','),
      disclaimerAccepted:
        query.disclaimerAccepted === undefined ? undefined : query.disclaimerAccepted === 'true',
      limit: LOOKUP_FETCH_LIMIT,
      locale: query.locale,
    });
    return toLookupResponse(
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        kind: r.kind,
        role: r.role,
        disclaimerAccepted: r.disclaimerAcceptedAt != null,
      })),
    );
  }

  /** The workspaces of the forms the caller holds the submitter role on or has submitted to. */
  async listMine(actorId: string, locale: SortLocale) {
    return toLookupResponse(
      await listWorkspacesForSubmitter({ userId: actorId, limit: LOOKUP_FETCH_LIMIT, locale }),
    );
  }

  async getCurrent(workspaceId: string, actorId: string) {
    const row = await getWorkspaceForUser(workspaceId, actorId);
    if (!row) return null;
    return this.toWorkspaceItem(row);
  }

  private toWorkspaceItem(row: {
    id: string;
    name: string;
    kind: string;
    role: string;
    status: string;
    org: string | null;
    useCase: string | null;
    disclaimerAcceptedAt: Date | null;
  }) {
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      role: row.role,
      status: row.status,
      org: row.org,
      useCase: row.useCase,
      disclaimerAccepted: row.disclaimerAcceptedAt != null,
    };
  }

  private async assertCanCreate(idpCode: string | null) {
    if (!(await canCreateWorkspaceByIdp(idpCode))) {
      throw new ForbiddenError(WORKSPACE_CREATE_FORBIDDEN);
    }
  }

  async create(
    actorId: string,
    idpCode: string | null,
    body: { name: string; org: string; useCase: string; disclaimerAccepted?: boolean },
  ) {
    await this.assertCanCreate(idpCode);
    const workspaceId = await createTeamWorkspace(
      actorId,
      body.name,
      body.org,
      body.useCase,
      body.disclaimerAccepted ?? false,
    );
    const row = await getWorkspaceForUser(workspaceId, actorId);
    if (!row) {
      throw new Error('Created workspace could not be loaded');
    }
    return this.toWorkspaceItem(row);
  }

  /**
   * Whether this (team) name is free in this org, case-insensitively, for the live name check.
   * Mirrors the authorization of the save this check is previewing: create's idp eligibility
   * when checking a brand-new name, or update's manage-role membership when excludeWorkspaceId
   * names the workspace being edited.
   */
  async checkNameAvailable(
    actorId: string,
    idpCode: string | null,
    org: string,
    name: string,
    excludeWorkspaceId?: string,
  ) {
    if (excludeWorkspaceId) {
      const membership = await getWorkspaceForUser(excludeWorkspaceId, actorId);
      if (!membership || !isWorkspaceManageRole(membership.role)) {
        throw new ForbiddenError(WORKSPACE_MANAGE_FORBIDDEN);
      }
    } else {
      await this.assertCanCreate(idpCode);
    }
    const exists = await workspaceNameExistsForKindAndOrg(
      WorkspaceKind.team,
      org,
      name,
      excludeWorkspaceId,
    );
    return { available: !exists };
  }

  async update(
    workspaceId: string,
    actorId: string,
    body: { name?: string; org?: string; useCase?: string; disclaimerAccepted?: boolean },
  ) {
    const updated = await updateWorkspace(workspaceId, actorId, body);
    if (!updated) {
      throw new ForbiddenError(WORKSPACE_MANAGE_FORBIDDEN);
    }
    const row = await getWorkspaceForUser(workspaceId, actorId);
    if (!row) return null;
    return this.toWorkspaceItem(row);
  }
}

export const workspacesApiService = new WorkspacesApiService();
