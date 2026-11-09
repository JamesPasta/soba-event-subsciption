import express from 'express';
import { requireFeature } from '../../core/middleware/requireFeature';
import { renderRateLimit } from '../../core/middleware/rateLimit';
import { Features } from '../../core/db/codes';
import { asyncHandler } from '../../core/api/shared/asyncHandler';
import { validateRequest } from '../../core/api/shared/validation';
import { listSubmissionTemplatesHandler, printDocumentHandler } from './controller';
import { PrintBodySchema, SubmissionIdParamSchema } from './schema';

const router = express.Router();

// Gate the whole feature on the `document-generation` and `templates` flags (within the submit
// surface's submit-mode).
router.use(requireFeature(Features.document_generation), requireFeature(Features.templates));

// Mounted under /submit/submissions, so these are /submit/submissions/:id/{templates,print}.
// templates: what the caller may render from the submission.
router.get(
  '/:id/templates',
  validateRequest({ params: SubmissionIdParamSchema }),
  asyncHandler(listSubmissionTemplatesHandler),
);

// print: render the submission's persisted data (read from the form engine).
router.post(
  '/:id/print',
  renderRateLimit,
  validateRequest({ params: SubmissionIdParamSchema, body: PrintBodySchema }),
  asyncHandler(printDocumentHandler),
);

export { router as documentGenerationRouter };
