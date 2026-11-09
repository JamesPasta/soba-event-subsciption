import express from 'express';
import { coreErrorHandler, notFoundHandler } from '../../middleware/errorHandler';
import { validateRequest } from '../shared/validation';
import { sortLocale } from '../../middleware/sortLocale';
import { requireFeature } from '../../middleware/requireFeature';
import { Features } from '../../db/codes';
import {
  addSobaAdminHandler,
  getFeatureScopeHandler,
  getJobHandler,
  listFeatureScopesHandler,
  listDocumentGenerationAuditsHandler,
  listJobsHandler,
  listJobTypesHandler,
  listSobaAdminsHandler,
  removeFeatureScopeHandler,
  removeSobaAdminHandler,
  rerunJobHandler,
  stopJobHandler,
  upsertFeatureScopeHandler,
} from './controller';
import {
  AddSobaAdminBodySchema,
  FeatureScopeIdParamsSchema,
  JobIdParamsSchema,
  ListFeatureScopesQuerySchema,
  ListDocumentGenerationAuditsQuerySchema,
  ListJobsQuerySchema,
  ListSobaAdminsQuerySchema,
  SobaAdminUserIdParamsSchema,
  UpsertFeatureScopeBodySchema,
} from './schema';

const router = express.Router();

router.get(
  '/soba-admins',
  validateRequest({ query: ListSobaAdminsQuerySchema }),
  sortLocale,
  listSobaAdminsHandler,
);
router.post('/soba-admins', validateRequest({ body: AddSobaAdminBodySchema }), addSobaAdminHandler);
router.delete(
  '/soba-admins/:userId',
  validateRequest({ params: SobaAdminUserIdParamsSchema }),
  removeSobaAdminHandler,
);
router.get(
  '/feature-scopes',
  validateRequest({ query: ListFeatureScopesQuerySchema }),
  listFeatureScopesHandler,
);
router.get(
  '/feature-scopes/:featureScopeId',
  validateRequest({ params: FeatureScopeIdParamsSchema }),
  getFeatureScopeHandler,
);
router.delete(
  '/feature-scopes/:featureScopeId',
  validateRequest({ params: FeatureScopeIdParamsSchema }),
  removeFeatureScopeHandler,
);
router.post(
  '/feature-scopes',
  validateRequest({ body: UpsertFeatureScopeBodySchema }),
  upsertFeatureScopeHandler,
);
router.get(
  '/document-generation/audits',
  requireFeature(Features.document_generation),
  validateRequest({ query: ListDocumentGenerationAuditsQuerySchema }),
  listDocumentGenerationAuditsHandler,
);
router.get('/jobs', validateRequest({ query: ListJobsQuerySchema }), listJobsHandler);
// Before /jobs/:jobId, which would take "types" as an id.
router.get('/jobs/types', listJobTypesHandler);
router.get('/jobs/:jobId', validateRequest({ params: JobIdParamsSchema }), getJobHandler);
router.post('/jobs/:jobId/rerun', validateRequest({ params: JobIdParamsSchema }), rerunJobHandler);
router.post('/jobs/:jobId/cancel', validateRequest({ params: JobIdParamsSchema }), stopJobHandler);

router.use(notFoundHandler);
router.use(coreErrorHandler);

export { router as adminRouter };
