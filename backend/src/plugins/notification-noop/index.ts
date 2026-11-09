import type { NotificationPluginDefinition } from '../../core/integrations/notification/NotificationAdapter';

const CODE = 'notification-noop';

/** No-op notification: sends nothing, no external call. */
export const notificationPluginDefinition: NotificationPluginDefinition = {
  code: CODE,
  metadata: {
    code: CODE,
    name: 'No-op notification',
  },
  createAdapter: () => ({
    sendEmail: () => Promise.resolve({ id: null, status: 'not_sent' }),
  }),
};
