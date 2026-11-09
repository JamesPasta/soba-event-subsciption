/**
 * Per-route workspace context resolution. Workspace context is derived explicitly per route:
 * - `workspaceFromQuery`: read the `workspaceId` query param.
 * - `workspaceListScope`: resolve workspace from a scope anchor (workspace or resource hierarchy id).
 * - `workspaceFromResource`: derive the workspace from the target resource.
 *
 */
import type { NextFunction, Request, Response } from 'express';
import { findActorMembership } from '../db/repos/membershipRepo';
import { getWorkspaceById } from '../db/repos/workspaceRepo';
import { ForbiddenError, NotFoundError, ValidationError } from '../errors';
import { getActorId } from './actor';
import { getFormListContext, getWorkspaceIdForForm } from '../db/repos/formRepo';
import { getFormVersionListContext } from '../db/repos/formVersionRepo';
import { getSubmissionListContext } from '../db/repos/submissionRepo';
import { getDocumentTemplateScope } from '../db/repos/documentTemplateRepo';
import type { CoreRequestContext } from './requestContext';

const RESOURCE_NOT_FOUND = 'Resource not found';
const MISSING_ACTOR_IDENTITY = 'Missing actor identity';

export type ListAnchorKind = 'workspaceId' | 'formId' | 'formVersionId' | 'submissionId';

type ListScopeQuery = Partial<Record<ListAnchorKind, string>>;

export type ResolvedListScope = {
  workspaceId: string;
  anchorKind: ListAnchorKind;
  /** The form a form, version or submission anchor belongs to. */
  formId?: string;
};

const readQueryString = (query: ListScopeQuery, key: ListAnchorKind): string | undefined => {
  const value = query[key];
  return typeof value === 'string' && value ? value : undefined;
};

const assertHierarchyMatch = (
  field: ListAnchorKind,
  expected: string,
  actual: string | undefined,
): void => {
  if (actual !== undefined && actual !== expected) {
    throw new ValidationError(`${field} is inconsistent with the resolved resource hierarchy`);
  }
};

/**
 * Resolve the workspace for a list/search request from the most specific scope anchor present,
 * and verify any additional hierarchy ids in the query are consistent with that anchor.
 */
export const resolveListWorkspaceScope = async (
  query: ListScopeQuery,
  anchorOrder: ListAnchorKind[],
): Promise<ResolvedListScope> => {
  let anchorKind: ListAnchorKind | null = null;
  for (const key of anchorOrder) {
    if (readQueryString(query, key)) {
      anchorKind = key;
      break;
    }
  }

  if (!anchorKind) {
    throw new ValidationError('Missing scope anchor');
  }

  const qWorkspaceId = readQueryString(query, 'workspaceId');
  const qFormId = readQueryString(query, 'formId');
  const qFormVersionId = readQueryString(query, 'formVersionId');

  switch (anchorKind) {
    case 'submissionId': {
      const submissionId = readQueryString(query, 'submissionId')!;
      const context = await getSubmissionListContext(submissionId);
      if (!context) {
        throw new NotFoundError(RESOURCE_NOT_FOUND);
      }
      assertHierarchyMatch('formVersionId', context.formVersionId, qFormVersionId);
      assertHierarchyMatch('formId', context.formId, qFormId);
      assertHierarchyMatch('workspaceId', context.workspaceId, qWorkspaceId);
      return { workspaceId: context.workspaceId, anchorKind, formId: context.formId };
    }
    case 'formVersionId': {
      const formVersionId = readQueryString(query, 'formVersionId')!;
      const context = await getFormVersionListContext(formVersionId);
      if (!context) {
        throw new NotFoundError(RESOURCE_NOT_FOUND);
      }
      assertHierarchyMatch('formId', context.formId, qFormId);
      assertHierarchyMatch('workspaceId', context.workspaceId, qWorkspaceId);
      return { workspaceId: context.workspaceId, anchorKind, formId: context.formId };
    }
    case 'formId': {
      const formId = readQueryString(query, 'formId')!;
      const context = await getFormListContext(formId);
      if (!context) {
        throw new NotFoundError(RESOURCE_NOT_FOUND);
      }
      assertHierarchyMatch('workspaceId', context.workspaceId, qWorkspaceId);
      return { workspaceId: context.workspaceId, anchorKind, formId };
    }
    case 'workspaceId': {
      return { workspaceId: readQueryString(query, 'workspaceId')!, anchorKind };
    }
  }
};

/**
 * Build the core request context for an already-resolved workspace from the actor's membership and
 * display label. Throws ForbiddenError when the actor is not a member.
 */
export const buildCoreContext = async (
  actorId: string,
  workspaceId: string,
  source: string,
): Promise<CoreRequestContext> => {
  const actor = await findActorMembership(workspaceId, actorId);
  if (!actor?.role) {
    throw new ForbiddenError('Actor does not belong to workspace');
  }
  return {
    workspaceId,
    actorId,
    actorDisplayLabel: actor.displayLabel,
    workspaceSource: source,
    role: actor.role,
  };
};

/** Workspace-scoped routes (lists/creates): workspace comes from the `workspaceId` query param. */
export const workspaceFromQuery = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const actorId = getActorId(req);
    if (!actorId) {
      throw new ValidationError(MISSING_ACTOR_IDENTITY);
    }
    const raw = req.query.workspaceId;
    const workspaceId = typeof raw === 'string' ? raw : '';
    if (!workspaceId) {
      throw new ValidationError('Missing workspaceId query parameter');
    }
    req.coreContext = await buildCoreContext(actorId, workspaceId, 'query');
    next();
  } catch (error) {
    next(error);
  }
};

/** Workspace-scoped routes (creates): workspace comes from the `workspaceId` body param. */
export const workspaceFromBody = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const actorId = getActorId(req);
    if (!actorId) {
      throw new ValidationError(MISSING_ACTOR_IDENTITY);
    }
    const raw = req.body?.workspaceId;
    const workspaceId = typeof raw === 'string' ? raw : '';
    if (!workspaceId) {
      throw new ValidationError('Missing workspaceId body parameter');
    }
    req.coreContext = await buildCoreContext(actorId, workspaceId, 'body');
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * List/search routes: resolve workspace from the most specific scope anchor in the query,
 * verify hierarchy consistency, membership, and restrict results to that workspace. A form,
 * version or submission anchor also puts its form in context.
 */
export const workspaceListScope = (config: {
  anchorOrder: ListAnchorKind[];
  allowEmpty?: boolean;
}) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const actorId = getActorId(req);
      if (!actorId) {
        throw new ValidationError(MISSING_ACTOR_IDENTITY);
      }

      const query: ListScopeQuery = {};
      let hasAnchor = false;
      for (const key of config.anchorOrder) {
        const value = req.query[key];
        if (typeof value === 'string' && value) {
          query[key] = value;
          hasAnchor = true;
        }
      }

      if (!hasAnchor && config.allowEmpty) {
        req.listScope = {
          actorId,
          workspaceIds: [], // Will be populated by downstream requireFormPermissions
          selectedWorkspaceId: undefined,
        };
        return next();
      }

      const resolved = await resolveListWorkspaceScope(query, config.anchorOrder);
      const context = await buildCoreContext(
        actorId,
        resolved.workspaceId,
        `list:${resolved.anchorKind}`,
      );
      req.coreContext = resolved.formId ? { ...context, formId: resolved.formId } : context;
      req.listScope = {
        actorId,
        workspaceIds: [resolved.workspaceId],
        selectedWorkspaceId: resolved.workspaceId,
      };
      next();
    } catch (error) {
      next(error);
    }
  };
};

export type WorkspaceResourceKind =
  | 'form'
  | 'formVersion'
  | 'submission'
  | 'template'
  | 'workspace';
export type ResourceIdSource = 'paramsId' | 'queryFormId' | 'queryFormVersionId' | 'bodyFormId';

/** The workspace a resource belongs to and, for a form or anything under one, the form. */
type ResourceScope = { workspaceId: string; formId?: string };

const lookupResourceScope = async (
  kind: WorkspaceResourceKind,
  resourceId: string,
): Promise<ResourceScope | null> => {
  switch (kind) {
    case 'form': {
      const workspaceId = await getWorkspaceIdForForm(resourceId);
      return workspaceId ? { workspaceId, formId: resourceId } : null;
    }
    case 'formVersion':
      return getFormVersionListContext(resourceId);
    case 'submission':
      return getSubmissionListContext(resourceId);
    case 'template':
      return getDocumentTemplateScope(resourceId);
    case 'workspace': {
      // The resource is the workspace itself. Confirm it exists so a missing workspace
      // yields 404 (matching workspaces/schema.ts); membership is then verified by
      // buildCoreContext, which yields 403 for an existing workspace the actor can't access.
      const workspace = await getWorkspaceById(resourceId);
      return workspace ? { workspaceId: resourceId } : null;
    }
  }
};

const nonEmptyString = (value: unknown): string | null =>
  typeof value === 'string' && value ? value : null;

const readResourceId = (req: Request, idFrom: ResourceIdSource): string | null => {
  switch (idFrom) {
    case 'paramsId':
      return nonEmptyString(req.params.id);
    case 'queryFormId':
      return nonEmptyString(req.query.formId);
    case 'queryFormVersionId':
      return nonEmptyString(req.query.formVersionId);
    case 'bodyFormId':
      return nonEmptyString((req.body as { formId?: unknown } | undefined)?.formId);
  }
};

/**
 * Resource (deep-link) routes: derive the workspace from the target resource, then verify access.
 * Missing resource -> 404 (no info leak). Non-member -> 403 (enforced by buildCoreContext).
 */
export const workspaceFromResource = (config: {
  kind: WorkspaceResourceKind;
  idFrom: ResourceIdSource;
}) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const actorId = getActorId(req);
      if (!actorId) {
        throw new ValidationError(MISSING_ACTOR_IDENTITY);
      }
      const resourceId = readResourceId(req, config.idFrom);
      if (!resourceId) {
        throw new ValidationError('Missing resource identifier for workspace resolution');
      }
      const scope = await lookupResourceScope(config.kind, resourceId);
      if (!scope) {
        throw new NotFoundError(RESOURCE_NOT_FOUND);
      }
      const context = await buildCoreContext(actorId, scope.workspaceId, `resource:${config.kind}`);
      req.coreContext = scope.formId ? { ...context, formId: scope.formId } : context;

      next();
    } catch (error) {
      next(error);
    }
  };
};
