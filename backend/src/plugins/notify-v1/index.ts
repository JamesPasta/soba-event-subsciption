import type { NotificationPluginDefinition } from '../../core/integrations/notification/NotificationAdapter';
import { NotifyV1Adapter } from './notifyV1Adapter';

export const notificationPluginDefinition: NotificationPluginDefinition = {
  code: 'notify-v1',
  metadata: { code: 'notify-v1', name: 'Notify', version: 'v1' },
  createAdapter: (config) => new NotifyV1Adapter(config),
};
