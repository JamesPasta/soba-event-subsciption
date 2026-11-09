import { documentGenerationRouter } from './route';
import { registerDocumentGenerationOpenApi } from './schema';
import type { CoreDomain } from '../../core/api/shared/openapi';

export { documentGenerationDesignRouter } from './designRoute';

export const documentGenerationDomain: CoreDomain = {
  path: '/submissions',
  router: documentGenerationRouter,
  registerOpenApi: registerDocumentGenerationOpenApi,
};
