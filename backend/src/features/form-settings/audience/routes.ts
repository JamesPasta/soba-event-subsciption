import type { Router } from 'express';
import { asyncHandler } from '../../../core/api/shared/asyncHandler';
import { countFormsInheritingAudience } from '../../../core/db/repos/audienceSettingRepo';
import { settingsRoutes } from '../routes';
import { WorkspaceAudienceSettingsSchema } from './openapi';
import { workspaceAudienceService } from './service';

/**
 * A workspace's audience routes, plus how many forms use it. A change reaches those forms, so the
 * count is read before a change is confirmed. Like the audience, any member may read it.
 */
export const workspaceAudienceRoutes = (): Router => {
  const router = settingsRoutes(
    workspaceAudienceService,
    WorkspaceAudienceSettingsSchema,
    'workspace',
  );
  router.get(
    '/inheriting-forms',
    asyncHandler(async (req, res) => {
      res.json({ count: await countFormsInheritingAudience(req.coreContext!.workspaceId) });
    }),
  );
  return router;
};
