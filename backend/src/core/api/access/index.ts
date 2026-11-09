export { accessRouter } from './route';
export { registerAccessOpenApi } from './schema';
import { accessRouter } from './route';
import { registerAccessOpenApi } from './schema';
import type { CoreDomain } from '../shared/openapi';

export const accessDomain: CoreDomain = {
  path: '/',
  router: accessRouter,
  registerOpenApi: registerAccessOpenApi,
};
