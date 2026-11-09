import express from 'express';
import { env } from '../../core/config/env';
import { Features, Permissions } from '../../core/db/codes';
import { asyncHandler } from '../../core/api/shared/asyncHandler';
import { validateRequest } from '../../core/api/shared/validation';
import { parseUpload } from '../../core/middleware/parseUpload';
import { requireFeature } from '../../core/middleware/requireFeature';
import { requireFormPermissions } from '../../core/middleware/requireFormPermissions';
import { workspaceFromResource } from '../../core/middleware/workspaceContext';
import {
  TemplateIdParamsSchema,
  TemplateNameBodySchema,
  TemplateUploadBodySchema,
  TemplatesFormQuerySchema,
  TemplateVersionQuerySchema,
} from './schema';
import {
  createTemplateHandler,
  deleteTemplateHandler,
  downloadTemplateHandler,
  getTemplateHandler,
  listTemplatesHandler,
  renameTemplateHandler,
  replaceTemplateFileHandler,
} from './controller';

const router = express.Router();

const upload = parseUpload(env.getTemplatesMaxFileSizeMb() * 1024 * 1024);

const onForm = [
  validateRequest({ query: TemplatesFormQuerySchema }),
  workspaceFromResource({ kind: 'form', idFrom: 'queryFormId' }),
];
const onFormVersion = [
  validateRequest({ query: TemplateVersionQuerySchema }),
  workspaceFromResource({ kind: 'formVersion', idFrom: 'queryFormVersionId' }),
];
const onTemplate = [
  validateRequest({ params: TemplateIdParamsSchema }),
  workspaceFromResource({ kind: 'template', idFrom: 'paramsId' }),
];
const canRead = requireFormPermissions([Permissions.form_read, Permissions.document_template_read]);
const canWrite = requireFormPermissions([Permissions.document_template_create]);
const canDelete = requireFormPermissions([Permissions.document_template_delete]);

router.use(requireFeature(Features.templates), requireFeature(Features.design_mode));

router.get('/', ...onForm, canRead, asyncHandler(listTemplatesHandler));
// Uploads are authorized before the body is parsed, so an unauthorized caller never buffers a file.
router.post(
  '/',
  ...onFormVersion,
  canWrite,
  upload,
  validateRequest({ body: TemplateUploadBodySchema }),
  asyncHandler(createTemplateHandler),
);
router.get('/:id', ...onTemplate, canRead, asyncHandler(getTemplateHandler));
router.get('/:id/content', ...onTemplate, canRead, asyncHandler(downloadTemplateHandler));
router.put(
  '/:id/content',
  ...onTemplate,
  canWrite,
  upload,
  asyncHandler(replaceTemplateFileHandler),
);
router.patch(
  '/:id',
  ...onTemplate,
  validateRequest({ body: TemplateNameBodySchema }),
  canWrite,
  asyncHandler(renameTemplateHandler),
);
router.delete('/:id', ...onTemplate, canDelete, asyncHandler(deleteTemplateHandler));

export { router as templatesRouter };
