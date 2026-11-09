import type { UserSearchPluginDefinition } from '../../core/integrations/user-search/UserSearchPluginDefinition';
import { CssUserSearchAdapter } from './cssUserSearchAdapter';

const CODE = 'css-v1';

export const userSearchPluginDefinition: UserSearchPluginDefinition = {
  code: CODE,
  metadata: { code: CODE, name: 'CSS user search', version: 'v1' },
  createAdapter: (config) => new CssUserSearchAdapter(config),
};
