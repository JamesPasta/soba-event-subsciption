import type { UserSearchPluginDefinition } from '../../core/integrations/user-search/UserSearchPluginDefinition';
import { SobaUserSearchAdapter } from './sobaUserSearchAdapter';

const CODE = 'user-search-soba';

export const userSearchPluginDefinition: UserSearchPluginDefinition = {
  code: CODE,
  metadata: { code: CODE, name: 'Soba user search' },
  createAdapter: () => new SobaUserSearchAdapter(),
};
