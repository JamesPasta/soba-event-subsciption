import express, { type RequestHandler } from 'express';
import type { z, ZodTypeAny } from 'zod';
import { validateRequest } from '../../core/api/shared/validation';
import { asyncHandler } from '../../core/api/shared/asyncHandler';
import { requireFormPermissions } from '../../core/middleware/requireFormPermissions';
import { requireWorkspaceManage } from '../../core/middleware/requireWorkspaceRole';
import { Permissions } from '../../core/db/codes';
import type { CoreRequestContext } from '../../core/middleware/requestContext';

/**
 * What a settings service reads from the request: the workspace and the actor. Callers outside the
 * settings routes, such as the drafts check, read without an actor id.
 */
export type FormSettingsContext = Pick<CoreRequestContext, 'workspaceId' | 'actorDisplayLabel'> & {
  actorId?: string;
};

/** Reads and writes one settings group of a form, or of a workspace at its workspace level. */
export interface FormSettingsService<TSettings, TBody> {
  get(ctx: FormSettingsContext, id: string): Promise<TSettings>;
  set(ctx: FormSettingsContext, id: string, body: TBody): Promise<TSettings>;
}

export type SettingsScope = 'form' | 'workspace';

/**
 * Who may read and write each scope. A form's group follows its form permissions. A workspace's is
 * readable by any member, which resolving the workspace has already checked, and writable by owners
 * and admins.
 */
export const scopeGates = (
  scope: SettingsScope,
): { read: RequestHandler[]; write: RequestHandler[] } =>
  scope === 'form'
    ? {
        read: [requireFormPermissions([Permissions.form_read])],
        write: [requireFormPermissions([Permissions.form_update])],
      }
    : { read: [], write: [requireWorkspaceManage] };

/**
 * The standard routes of a settings group: GET, and a PUT whose body matches `bodySchema`. The
 * shared settings router has already resolved the form or workspace. Permissions are checked before
 * the body, so a caller who may not write learns nothing from validation errors.
 */
export const settingsRoutes = <TSettings, TSchema extends ZodTypeAny>(
  service: FormSettingsService<TSettings, z.infer<TSchema>>,
  bodySchema: TSchema,
  scope: SettingsScope = 'form',
): express.Router => {
  const gates = scopeGates(scope);
  const router = express.Router({ mergeParams: true });
  router.get(
    '/',
    ...gates.read,
    asyncHandler(async (req, res) => {
      res.json(await service.get(req.coreContext!, req.params.id));
    }),
  );
  router.put(
    '/',
    ...gates.write,
    validateRequest({ body: bodySchema }),
    asyncHandler(async (req, res) => {
      res.json(await service.set(req.coreContext!, req.params.id, req.body as z.infer<TSchema>));
    }),
  );
  return router;
};
