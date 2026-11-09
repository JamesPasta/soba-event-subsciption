import express from 'express';
import { env } from '../../core/config/env';
import { requireFeature } from '../../core/middleware/requireFeature';
import { Features } from '../../core/db/codes';
import { requireUploadAccess } from './uploadAccess';
import { parseUpload } from '../../core/middleware/parseUpload';
import { uploadFileHandler, downloadFileHandler, deleteFileHandler } from './controller';
import { asyncHandler } from '../../core/api/shared/asyncHandler';

const router = express.Router();

const maxSizeMb = env.getFilesMaxFileSizeMb();

// Gate the whole feature on the `soba.feature` files flag.
router.use(requireFeature(Features.files));

// Upload: the multipart body is parsed first (any file field name; Form.io's fileKey is
// configurable), then requireUploadAccess resolves the workspace from the `submissionId` field and
// authorizes an upload to that submission.
router.post(
  '/',
  parseUpload(maxSizeMb * 1024 * 1024),
  requireUploadAccess,
  asyncHandler(uploadFileHandler),
);

// Download / delete: authorized against the file's owning submission in the service. Wrapped in
// asyncHandler so an unexpected failure reaches the router's error handler instead of hanging.
router.get('/:id', asyncHandler(downloadFileHandler));
router.delete('/:id', asyncHandler(deleteFileHandler));

export { router as filesRouter };
