import { z } from 'zod';
import { asyncHandler } from '../../../core/api/shared/asyncHandler';
import { requireFormPermissions } from '../../../core/middleware/requireFormPermissions';
import { Permissions } from '../../../core/db/codes';
import {
  EVENT_SUBSCRIPTION_SETTINGS_KEY,
  EventSubscriptionSettingsSchema,
  SetEventSubscriptionSettingsBodySchema,
} from '@soba/lib';
import { formEventSubscriptions } from '../../../core/db/schema';
import { FormSettingsParamsSchema, registerSettingsPaths } from '../schema';
import { settingsRoutes } from '../routes';
import type { FormSettingsModule } from '../types';
import { createEventSubscription } from './repo';
import { eventSubscriptionService, revealEventSubscriptionToken } from './service';

const revealPath = `/design/forms/{id}/settings/${EVENT_SUBSCRIPTION_SETTINGS_KEY}/token`;

export const eventSubscriptionSettingsModule: FormSettingsModule = {
  key: EVENT_SUBSCRIPTION_SETTINGS_KEY,
  weight: 35,
  router: () => {
    const router = settingsRoutes(eventSubscriptionService, SetEventSubscriptionSettingsBodySchema);
    router.get(
      '/token',
      requireFormPermissions([Permissions.form_update]),
      asyncHandler(async (req, res) => {
        res.setHeader('Cache-Control', 'private, no-store');
        res.json(await revealEventSubscriptionToken(req.coreContext!, req.params.id));
      }),
    );
    return router;
  },
  registerOpenApi: (registry) => {
    registerSettingsPaths(registry, {
      key: EVENT_SUBSCRIPTION_SETTINGS_KEY,
      label: 'event subscription settings',
      settingsSchema: EventSubscriptionSettingsSchema,
      bodySchema: SetEventSubscriptionSettingsBodySchema,
    });
    registry.registerPath({
      method: 'get',
      path: revealPath,
      tags: ['core.form-settings'],
      security: [{ bearerAuth: [] }],
      request: { params: FormSettingsParamsSchema },
      responses: {
        200: {
          description: 'Reveal the saved endpoint token (requires form_update; never cached)',
          content: { 'application/json': { schema: z.object({ token: z.string() }) } },
        },
        403: { description: 'Requires form_update' },
        404: { description: 'Form or token not found' },
      },
    });
  },
  tables: [formEventSubscriptions],
  createForForm: createEventSubscription,
};
