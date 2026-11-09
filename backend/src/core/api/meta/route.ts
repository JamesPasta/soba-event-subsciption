import express from 'express';
import { validateRequest } from '../shared/validation';
import { requireFeature } from '../../middleware/requireFeature';
import { coreErrorHandler, notFoundHandler } from '../../middleware/errorHandler';
import { Features } from '../../db/codes';
import { sortLocale } from '../../middleware/sortLocale';
import { SortLocaleQuerySchema } from '../shared/offsetPagination';
import {
  getBuildMeta,
  getCodesMeta,
  getFeatureAvailabilityMeta,
  getFeaturesMeta,
  getFilesConfigMeta,
  getFrontendConfigMeta,
  getFormEnginesMeta,
  getLoginProvidersMeta,
  getPluginsMeta,
  getRolesMeta,
} from './controller';
import {
  FeatureAvailabilityQuerySchema,
  ListCodesQuerySchema,
  ListRolesQuerySchema,
} from './schema';

const router = express.Router();

router.get('/plugins', getPluginsMeta);
router.get('/features', getFeaturesMeta);
router.get(
  '/feature-availability',
  validateRequest({ query: FeatureAvailabilityQuerySchema }),
  getFeatureAvailabilityMeta,
);
router.get('/form-engines', getFormEnginesMeta);
router.get(
  '/login-providers',
  validateRequest({ query: SortLocaleQuerySchema }),
  sortLocale,
  getLoginProvidersMeta,
);
router.get('/build', getBuildMeta);
router.get('/frontend-config', getFrontendConfigMeta);
// Files config is public but only meaningful when the feature is on — gate it so it 404s otherwise.
router.get('/files-config', requireFeature(Features.files), getFilesConfigMeta);
router.get('/codes', validateRequest({ query: ListCodesQuerySchema }), getCodesMeta);
router.get('/roles', validateRequest({ query: ListRolesQuerySchema }), getRolesMeta);
router.use(notFoundHandler);
router.use(coreErrorHandler);

export { router as metaRouter };
