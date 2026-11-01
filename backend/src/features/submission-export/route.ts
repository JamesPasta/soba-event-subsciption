import express from 'express';
import { validateRequest } from '../../core/api/shared/validation';
import { Features, Permissions } from '../../core/db/codes';
import { requireFeature } from '../../core/middleware/requireFeature';
import { requireFormPermissions } from '../../core/middleware/requireFormPermissions';
import { workspaceFromResource } from '../../core/middleware/workspaceContext';
import {
  cancelExport,
  downloadExport,
  getExport,
  getExportFields,
  listExports,
  startExport,
} from './controller';
import {
  ExportIdParamSchema,
  FormIdParamSchema,
  ListExportsQuerySchema,
  StartSubmissionExportBodySchema,
  SubmissionExportFieldsBodySchema,
} from './schema';

// Mounted at the root of /design, so every route gates itself: permissions before the feature flag,
// so a caller without access learns nothing of it. Never router.use, which would gate every later
// /design route.
const router = express.Router();

const EXPORTS_PATH = '/forms/:id/exports';
const formResource = workspaceFromResource({ kind: 'form', idFrom: 'paramsId' });
const readsSubmissions = requireFormPermissions([Permissions.submission_read]);
const exportsOn = requireFeature(Features.submission_export);
const gates = [formResource, readsSubmissions, exportsOn];

router.post(
  `${EXPORTS_PATH}/fields`,
  validateRequest({ params: FormIdParamSchema, body: SubmissionExportFieldsBodySchema }),
  ...gates,
  getExportFields,
);
router.post(
  EXPORTS_PATH,
  validateRequest({ params: FormIdParamSchema, body: StartSubmissionExportBodySchema }),
  ...gates,
  startExport,
);
router.get(
  EXPORTS_PATH,
  validateRequest({ params: FormIdParamSchema, query: ListExportsQuerySchema }),
  ...gates,
  listExports,
);
router.get(
  `${EXPORTS_PATH}/:exportId`,
  validateRequest({ params: ExportIdParamSchema }),
  ...gates,
  getExport,
);
router.get(
  `${EXPORTS_PATH}/:exportId/file`,
  validateRequest({ params: ExportIdParamSchema }),
  ...gates,
  downloadExport,
);
router.post(
  `${EXPORTS_PATH}/:exportId/cancel`,
  validateRequest({ params: ExportIdParamSchema }),
  ...gates,
  cancelExport,
);

export { router as submissionExportRouter };
