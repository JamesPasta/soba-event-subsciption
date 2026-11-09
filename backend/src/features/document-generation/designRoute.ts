import express from 'express';
import { requireFeature } from '../../core/middleware/requireFeature';
import { requireFormPermissions } from '../../core/middleware/requireFormPermissions';
import { workspaceFromResource } from '../../core/middleware/workspaceContext';
import { renderRateLimit } from '../../core/middleware/rateLimit';
import { Features, Permissions, PrintUploadPermissions } from '../../core/db/codes';
import { asyncHandler } from '../../core/api/shared/asyncHandler';
import { validateRequest } from '../../core/api/shared/validation';
import {
  listStaffSubmissionTemplatesHandler,
  printStaffDocumentHandler,
  printStaffUploadHandler,
} from './controller';
import { PrintBodySchema, SubmissionIdParamSchema } from './schema';

// Mounted at /design. Each route checks permissions before the feature flags so a caller without
// access learns nothing of them.
const router = express.Router();

const submissionResource = workspaceFromResource({ kind: 'submission', idFrom: 'paramsId' });
const features = [requireFeature(Features.document_generation), requireFeature(Features.templates)];
const readsSubmission = requireFormPermissions([Permissions.submission_read]);

router.get(
  '/submissions/:id/templates',
  validateRequest({ params: SubmissionIdParamSchema }),
  submissionResource,
  readsSubmission,
  ...features,
  asyncHandler(listStaffSubmissionTemplatesHandler),
);

router.post(
  '/submissions/:id/print',
  validateRequest({ params: SubmissionIdParamSchema, body: PrintBodySchema }),
  submissionResource,
  readsSubmission,
  ...features,
  renderRateLimit,
  asyncHandler(printStaffDocumentHandler),
);

// Its own path prefix, so its Route can wait out the scan. The handler reads the body itself,
// after it takes a render slot.
router.post(
  '/print-upload/:id',
  validateRequest({ params: SubmissionIdParamSchema }),
  submissionResource,
  requireFormPermissions(PrintUploadPermissions),
  ...features,
  renderRateLimit,
  asyncHandler(printStaffUploadHandler),
);

export { router as documentGenerationDesignRouter };
