import express, { type Request } from 'express';
import type { CredentialFields } from '@soba/lib';
import { asyncHandler } from '../../core/api/shared/asyncHandler';
import { validateRequest } from '../../core/api/shared/validation';
import type { CredentialOwner } from '../../core/db/repos/workspaceCredentialRepo';
import { sortLocale } from '../../core/middleware/sortLocale';
import { scopeGates, type SettingsScope } from '../form-settings/routes';
import {
  CredentialFieldsSchema,
  CredentialParamsSchema,
  EmptyCredentialBodySchema,
  ListCredentialsQuerySchema,
  type CredentialListQuery,
} from './schema';
import { credentialService } from './service';

/**
 * The API keys of a form, or of a workspace at its workspace level. Gated like every settings
 * group: a form's keys follow its form permissions, a workspace's are readable by any member and
 * changed by owners and admins. A form's list also shows its workspace's keys, read-only.
 */
export const apiKeySettingsRouter = (scope: SettingsScope): express.Router => {
  const gates = scopeGates(scope);
  const ownerOf = (req: Request): CredentialOwner => ({
    workspaceId: req.coreContext!.workspaceId,
    formId: scope === 'form' ? req.params.id : null,
  });
  const actorOf = (req: Request) => req.coreContext!.actorId;
  const keyPath = '/:credentialId';
  const keyParams = validateRequest({ params: CredentialParamsSchema });

  const router = express.Router({ mergeParams: true });
  // Set before the gates, so a refusal or failure of a key operation is not cached either.
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.get(
    '/',
    ...gates.read,
    validateRequest({ query: ListCredentialsQuerySchema }),
    sortLocale,
    asyncHandler(async (req, res) => {
      const query = { ...req.query, locale: req.sortLocale } as CredentialListQuery;
      res.json(await credentialService.list(ownerOf(req), query));
    }),
  );
  router.post(
    '/',
    ...gates.write,
    validateRequest({ body: CredentialFieldsSchema }),
    asyncHandler(async (req, res) => {
      const fields = req.body as CredentialFields;
      res.status(201).json(await credentialService.issue(ownerOf(req), actorOf(req), fields));
    }),
  );
  router.get(
    keyPath,
    ...gates.read,
    keyParams,
    asyncHandler(async (req, res) => {
      res.json(await credentialService.get(ownerOf(req), req.params.credentialId));
    }),
  );
  router.patch(
    keyPath,
    ...gates.write,
    validateRequest({ params: CredentialParamsSchema, body: CredentialFieldsSchema }),
    asyncHandler(async (req, res) => {
      const fields = req.body as CredentialFields;
      res.json(
        await credentialService.update(ownerOf(req), req.params.credentialId, actorOf(req), fields),
      );
    }),
  );
  router.post(
    `${keyPath}/regenerate`,
    ...gates.write,
    validateRequest({ params: CredentialParamsSchema, body: EmptyCredentialBodySchema }),
    asyncHandler(async (req, res) => {
      res.json(
        await credentialService.regenerate(ownerOf(req), req.params.credentialId, actorOf(req)),
      );
    }),
  );
  router.delete(
    keyPath,
    ...gates.write,
    keyParams,
    asyncHandler(async (req, res) => {
      await credentialService.remove(ownerOf(req), req.params.credentialId, actorOf(req));
      res.status(204).end();
    }),
  );
  return router;
};
