import express from 'express';
import { requireFeature } from '../../core/middleware/requireFeature';
import { requireFormPermissions } from '../../core/middleware/requireFormPermissions';
import { workspaceFromResource } from '../../core/middleware/workspaceContext';
import { Features, Permissions } from '../../core/db/codes';
import { asyncHandler } from '../../core/api/shared/asyncHandler';
import { validateRequest } from '../../core/api/shared/validation';
import { downloadSubmissionFileHandler } from './controller';
import { SubmissionFileParamsSchema } from './schema';

// Mounted at /design; permissions before the feature flag.
const router = express.Router();

router.get(
  '/submissions/:id/files/:fileId',
  validateRequest({ params: SubmissionFileParamsSchema }),
  workspaceFromResource({ kind: 'submission', idFrom: 'paramsId' }),
  requireFormPermissions([Permissions.submission_read]),
  requireFeature(Features.files),
  asyncHandler(downloadSubmissionFileHandler),
);

export { router as filesDesignRouter };
