export { filesRouter } from './route';
export { filesDesignRouter } from './designRoute';
export { registerFilesOpenApi } from './schema';
import { filesRouter } from './route';
import { registerFilesOpenApi } from './schema';
import type { CoreDomain } from '../../core/api/shared/openapi';

export const filesDomain: CoreDomain = {
  path: '/files',
  router: filesRouter,
  registerOpenApi: registerFilesOpenApi,
};
