import type { Request, Response } from 'express';
import {
  TEMPLATE_TYPE_FEATURES,
  templateExtensionsText,
  templateFileTypeFor,
  type TemplateResponse,
  type TemplateType,
  type TemplateUploadBody,
} from '@soba/lib';
import { templatesService, type TemplateActor, type TemplateFile } from './service';
import { DEFAULT_TEMPLATE_NAMES } from './config';
import { checkedFileName, getUploadedFile } from '../../core/middleware/parseUpload';
import { sendStoredFile } from '../../core/api/shared/sendStoredFile';
import { isFeatureAvailable } from '../../core/services/featureAvailabilityService';
import type { DocumentTemplateWithVersion } from '../../core/db/repos/documentTemplateRepo';
import {
  NotFoundError,
  ServiceUnavailableError,
  UnsupportedMediaTypeError,
  ValidationError,
} from '../../core/errors';
import { log } from '../../core/logging';

const TEMPLATE_NOT_FOUND = 'Template not found';

// The type column only holds TEMPLATE_TYPES; a check constraint enforces it.
const typeOf = (template: DocumentTemplateWithVersion): TemplateType =>
  template.template.type as TemplateType;

const toTemplateResponse = (stored: DocumentTemplateWithVersion): TemplateResponse => {
  const { template, file, formVersionNo } = stored;
  return {
    id: template.id,
    formId: template.formId,
    formVersionId: template.formVersionId,
    formVersionNo,
    type: typeOf(stored),
    name: template.name,
    filename: file.filename,
    contentType: file.contentType,
    size: file.size,
    createdBy: template.createdBy,
    createdAt: template.createdAt.toISOString(),
    updatedBy: template.updatedBy,
    updatedAt: template.updatedAt.toISOString(),
  };
};

// workspaceFromResource has resolved the form, form version or template into coreContext.
const actorOf = (req: Request): TemplateActor => {
  const ctx = req.coreContext!;
  return { workspaceId: ctx.workspaceId, actorId: ctx.actorId };
};

/** A new file of a type needs the type's feature on the form. */
async function assertTypeAvailable(req: Request, type: TemplateType): Promise<void> {
  const { workspaceId, formId } = req.coreContext!;
  if (!(await isFeatureAvailable(TEMPLATE_TYPE_FEATURES[type], { workspaceId, formId }))) {
    throw new ValidationError(`Template type ${type} is not available for this form`);
  }
}

function templateFile(req: Request, type: TemplateType): TemplateFile {
  const upload = getUploadedFile(req);
  if (!templateFileTypeFor(type, upload.originalname)) {
    throw new UnsupportedMediaTypeError(`Template must be one of: ${templateExtensionsText(type)}`);
  }
  return {
    filename: checkedFileName(upload.originalname),
    contentType: upload.mimetype,
    size: upload.size,
    buffer: upload.buffer,
  };
}

const found = (template: DocumentTemplateWithVersion | null): DocumentTemplateWithVersion => {
  if (!template) throw new NotFoundError(TEMPLATE_NOT_FOUND);
  return template;
};

const findTemplate = async (req: Request): Promise<DocumentTemplateWithVersion> =>
  found(await templatesService.get(req.params.id));

export async function listTemplatesHandler(req: Request, res: Response): Promise<void> {
  const templates = await templatesService.list(req.query.formId as string);
  res.json({ items: templates.map(toTemplateResponse) });
}

export async function createTemplateHandler(req: Request, res: Response): Promise<void> {
  const { formId } = req.coreContext!;
  if (!formId) throw new NotFoundError('Form version not found');
  const { type, name } = req.body as TemplateUploadBody;
  await assertTypeAvailable(req, type);
  const created = await templatesService.create(
    actorOf(req),
    { id: req.query.formVersionId as string, formId },
    { type, name: name || DEFAULT_TEMPLATE_NAMES[type] },
    templateFile(req, type),
  );
  res.status(201).json(toTemplateResponse(found(created)));
}

export async function getTemplateHandler(req: Request, res: Response): Promise<void> {
  res.json(toTemplateResponse(await findTemplate(req)));
}

export async function downloadTemplateHandler(req: Request, res: Response): Promise<void> {
  const template = await findTemplate(req);
  const file = await templatesService.open(template);
  if (!file) {
    const { id: fileId, profile } = template.file;
    log.warn({ templateId: template.template.id, fileId, profile }, 'Template content unavailable');
    throw new ServiceUnavailableError('Template content unavailable');
  }
  await sendStoredFile(res, template.file, file, 'attachment');
}

export async function replaceTemplateFileHandler(req: Request, res: Response): Promise<void> {
  const template = await findTemplate(req);
  await assertTypeAvailable(req, typeOf(template));
  const replaced = await templatesService.replaceFile(
    template,
    actorOf(req),
    templateFile(req, typeOf(template)),
  );
  res.json(toTemplateResponse(found(replaced)));
}

export async function renameTemplateHandler(req: Request, res: Response): Promise<void> {
  const { actorId } = actorOf(req);
  const renamed = await templatesService.rename(req.params.id, req.body.name as string, actorId);
  res.json(toTemplateResponse(found(renamed)));
}

export async function deleteTemplateHandler(req: Request, res: Response): Promise<void> {
  await templatesService.remove(await findTemplate(req));
  res.status(204).end();
}
