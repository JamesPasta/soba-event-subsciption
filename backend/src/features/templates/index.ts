import { templatesRouter } from './route';
import { registerTemplatesOpenApi } from './schema';
import type { CoreDomain } from '../../core/api/shared/openapi';

export const templatesDomain: CoreDomain = {
  path: '/templates',
  router: templatesRouter,
  registerOpenApi: registerTemplatesOpenApi,
};
