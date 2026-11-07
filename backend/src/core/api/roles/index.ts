export { rolesRouter } from './route';
export { registerRolesOpenApi } from './schema';
import { rolesRouter } from './route';
import { registerRolesOpenApi } from './schema';
import type { CoreDomain } from '../shared/openapi';

export const rolesDomain: CoreDomain = {
  path: '/',
  router: rolesRouter,
  registerOpenApi: registerRolesOpenApi,
};
