import { Request, RequestHandler, Response } from 'express';
import {
  ApiErrorCodes,
  PrintOptionsSchema,
  templateExtensionsText,
  type PrintBody,
  type PrintOptions,
} from '@soba/lib';
import {
  documentGenerationService,
  staffDocumentService,
  type DocumentRenderOutcome,
  type UploadedTemplate,
} from './service';
import { RENDER_BUSY, takeRenderSlot } from './renderSlots';
import { env } from '../../core/config/env';
import { resolveCaller } from '../../core/middleware/actor';
import { accessDenial } from '../../core/middleware/formSubmitAccess';
import { sendAttachment } from '../../core/api/shared/contentDisposition';
import { checkedFileName, getUploadedFile, parseUpload } from '../../core/middleware/parseUpload';
import { templateFileType } from '../../core/integrations/document-generation/templateFileType';
import {
  InternalError,
  NotFoundError,
  ServiceUnavailableError,
  UnprocessableEntityError,
  UnsupportedMediaTypeError,
  ValidationError,
} from '../../core/errors';

const NOT_AUTHORIZED = 'Not authorized to generate this document';
const SUBMISSION_NOT_FOUND = 'Submission not found';

const maxConcurrentRenders = env.getDocumentGenerationMaxConcurrent();
const parseTemplateUpload = parseUpload(env.getTemplatesMaxFileSizeMb() * 1024 * 1024);

/** Run a middleware that always calls next, as a promise. */
const runMiddleware = (handler: RequestHandler, req: Request, res: Response): Promise<void> =>
  new Promise((resolve, reject) => {
    handler(req, res, (err?: unknown) => {
      if (!err) resolve();
      else reject(err instanceof Error ? err : new Error('Middleware failed', { cause: err }));
    });
  });

/** Filename from the print options: `${reportName}.${convertTo}`, falling back to `document`. */
function buildFilename(options: PrintOptions | undefined): string {
  const base = options?.reportName ?? 'document';
  const ext = options?.convertTo ? `.${options.convertTo}` : '';
  return `${base}${ext}`;
}

/** Throw the API error for a render that produced no document. */
function throwRefusal(
  req: Request,
  outcome: Exclude<DocumentRenderOutcome, { status: 'ok' }>,
): never {
  switch (outcome.status) {
    case 'notfound':
      throw new NotFoundError(SUBMISSION_NOT_FOUND, ApiErrorCodes.submission_not_found);
    case 'template-notfound':
      throw new NotFoundError('Template not found', ApiErrorCodes.template_not_found);
    case 'template-unavailable':
      throw new ServiceUnavailableError(
        'Template content unavailable',
        ApiErrorCodes.template_unavailable,
      );
    case 'denied':
      throw accessDenial(req, NOT_AUTHORIZED, ApiErrorCodes.render_denied);
    case 'unavailable':
      throw new ServiceUnavailableError(
        'Document generation is not available for this submission',
        ApiErrorCodes.render_unavailable,
      );
    case 'busy':
      throw new ServiceUnavailableError(RENDER_BUSY, ApiErrorCodes.render_busy);
    case 'no-content':
      throw new UnprocessableEntityError(
        'Submission has no saved data to print',
        ApiErrorCodes.no_saved_data,
      );
    case 'infected':
      throw new UnprocessableEntityError('File failed virus scan', ApiErrorCodes.file_infected);
    case 'scan-unavailable':
      throw new ServiceUnavailableError(
        'Virus scanning unavailable',
        ApiErrorCodes.scan_unavailable,
      );
    case 'error':
      // The generic error for a failed render, or for a stored template that cannot be rendered.
      throw outcome.error;
    default: {
      const unhandled: never = outcome;
      throw new InternalError(`Unhandled document render outcome: ${String(unhandled)}`);
    }
  }
}

/** Stream the rendered document, or throw the error for the outcome. */
function respond(
  req: Request,
  res: Response,
  outcome: DocumentRenderOutcome,
  filename: string,
): void {
  if (outcome.status !== 'ok') throwRefusal(req, outcome);
  sendAttachment(res, outcome.contentType ?? 'application/octet-stream', filename, outcome.data);
}

function uploadedTemplate(req: Request): UploadedTemplate {
  const upload = getUploadedFile(req);
  const fileType = templateFileType(upload.originalname);
  if (!fileType) {
    throw new UnsupportedMediaTypeError(
      `Template must be one of: ${templateExtensionsText('cdogs')}`,
      ApiErrorCodes.file_type_blocked,
    );
  }
  return { content: upload.buffer, fileType, filename: checkedFileName(upload.originalname) };
}

export async function listSubmissionTemplatesHandler(req: Request, res: Response): Promise<void> {
  const outcome = await documentGenerationService.listTemplates(resolveCaller(req), req.params.id);
  if (outcome.status === 'notfound') {
    throw new NotFoundError(SUBMISSION_NOT_FOUND, ApiErrorCodes.submission_not_found);
  }
  if (outcome.status === 'denied')
    throw accessDenial(req, NOT_AUTHORIZED, ApiErrorCodes.render_denied);
  res.json(outcome.facts);
}

export async function printDocumentHandler(req: Request, res: Response): Promise<void> {
  const body = req.body as PrintBody;
  const outcome = await documentGenerationService.print(resolveCaller(req), {
    submissionId: req.params.id,
    templateId: body.templateId,
    options: body.options,
  });
  respond(req, res, outcome, buildFilename(body.options));
}

export async function listStaffSubmissionTemplatesHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const outcome = await staffDocumentService.listTemplates(
    req.coreContext!.workspaceId,
    req.params.id,
  );
  if (outcome.status === 'notfound') {
    throw new NotFoundError(SUBMISSION_NOT_FOUND, ApiErrorCodes.submission_not_found);
  }
  res.json(outcome.facts);
}

export async function printStaffDocumentHandler(req: Request, res: Response): Promise<void> {
  const { workspaceId, actorId } = req.coreContext!;
  const body = req.body as PrintBody;
  const outcome = await staffDocumentService.print(workspaceId, actorId, {
    submissionId: req.params.id,
    templateId: body.templateId,
    options: body.options,
  });
  respond(req, res, outcome, buildFilename(body.options));
}

/**
 * Print with a template uploaded in this request; it is rendered and discarded. The render slot is
 * taken before the body is read and released when the print ends, so a process holds at most one
 * uploaded template per slot.
 */
export async function printStaffUploadHandler(req: Request, res: Response): Promise<void> {
  const release = takeRenderSlot(maxConcurrentRenders);
  if (!release) throw new ServiceUnavailableError(RENDER_BUSY, ApiErrorCodes.render_busy);
  try {
    const { workspaceId, actorId } = req.coreContext!;
    const prepared = await staffDocumentService.prepareUpload(workspaceId, req.params.id);
    if (prepared.status !== 'ok') throwRefusal(req, prepared);

    // A request the client already dropped emits nothing more, so the parser would wait forever.
    if (req.destroyed) throw new ValidationError('Request closed', ApiErrorCodes.upload_invalid);
    await runMiddleware(parseTemplateUpload, req, res);
    const options = PrintOptionsSchema.safeParse(req.body);
    if (!options.success) {
      throw new ValidationError('Invalid request body', ApiErrorCodes.request_invalid);
    }
    const outcome = await staffDocumentService.printUpload(
      prepared.prepared,
      uploadedTemplate(req),
      options.data,
      actorId,
    );
    respond(req, res, outcome, buildFilename(options.data));
  } finally {
    release();
  }
}
