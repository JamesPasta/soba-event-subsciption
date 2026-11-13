import type { FormSettingsSection } from '../types';
import EventSubscription from './EventSubscription';

export const eventSubscriptionSection: FormSettingsSection = {
  id: 'event-subscription',
  weight: 45,
  Drawer: EventSubscription,
};
