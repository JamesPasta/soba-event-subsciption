import express, { type Request } from 'express';
import { asyncHandler } from '../../../core/api/shared/asyncHandler';
import { validateRequest } from '../../../core/api/shared/validation';
import { Permissions } from '../../../core/db/codes';
import { requireFormPermissions } from '../../../core/middleware/requireFormPermissions';
import { requireWorkspaceManage } from '../../../core/middleware/requireWorkspaceRole';
import type { SettingsScope } from '../../form-settings/routes';
import {
  ActionParamsSchema,
  SetFormActionBodySchema,
  SetWorkspaceActionBodySchema,
  type SetFormActionBody,
  type SetWorkspaceActionBody,
} from './schema';
import {
  getAction,
  listActions,
  setFormAction,
  setWorkspaceAction,
  type ActionScopeContext,
} from './service';

/**
 * The post-submission settings of a form, or of a workspace at its workspace level: a list of the
 * actions configurable there, and each action's GET and PUT at /:code. Reading needs the same
 * access as saving, because action options can hold recipient addresses.
 */
export const postSubmissionSettingsRouter = (scope: SettingsScope): express.Router => {
  const gate =
    scope === 'form' ? requireFormPermissions([Permissions.form_update]) : requireWorkspaceManage;
  const contextOf = (req: Request): ActionScopeContext => ({
    workspaceId: req.coreContext!.workspaceId,
    formId: scope === 'form' ? req.params.id : null,
    actorId: req.coreContext!.actorId,
    actorDisplayLabel: req.coreContext!.actorDisplayLabel,
  });

  const router = express.Router({ mergeParams: true });
  router.get(
    '/',
    gate,
    asyncHandler(async (req, res) => {
      res.json(await listActions(contextOf(req)));
    }),
  );
  router.get(
    '/:code',
    gate,
    validateRequest({ params: ActionParamsSchema }),
    asyncHandler(async (req, res) => {
      res.json(await getAction(req.params.code, contextOf(req)));
    }),
  );
  router.put(
    '/:code',
    gate,
    validateRequest({
      params: ActionParamsSchema,
      body: scope === 'form' ? SetFormActionBodySchema : SetWorkspaceActionBodySchema,
    }),
    asyncHandler(async (req, res) => {
      const ctx = contextOf(req);
      res.json(
        scope === 'form'
          ? await setFormAction(req.params.code, ctx, req.body as SetFormActionBody)
          : await setWorkspaceAction(req.params.code, ctx, req.body as SetWorkspaceActionBody),
      );
    }),
  );
  return router;
};
