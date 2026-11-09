import { getDocumentGenerationPluginDefinitions } from '../../core/integrations/plugins/PluginRegistry';
import {
  createDocumentGenerationAdapter,
  resolveDefaultDocumentGenerationCode,
} from '../../core/integrations/document-generation/DocumentGenerationRegistry';
import { getFeatureGateCached } from '../../core/db/repos/featureRepo';
import { findInOrder } from '../../core/inOrder';
import { isFeatureAvailable } from '../../core/services/featureAvailabilityService';
import {
  DocumentGenerationMode,
  DocumentGenerationOutcome,
  DocumentTemplateType,
  FeatureAvailability,
} from '../../core/db/codes';
import { getSubmissionRecordById, type SubmissionRecord } from '../../core/db/repos/submissionRepo';
import type { CallerIdentity } from '../../core/db/repos/formSubmitAccessRepo';
import {
  allowsSubmitterOperation,
  findSubmissionForCaller,
  SubmitterOperation,
} from '../../core/services/submitterAccess';
import { createDocumentGenerationAudit } from '../../core/db/repos/documentGenerationAuditRepo';
import {
  getLiveDocumentTemplate,
  listLiveDocumentTemplates,
  type DocumentTemplateWithFile,
} from '../../core/db/repos/documentTemplateRepo';
import { SubmissionService } from '../../core/services/submissionService';
import type { DocumentRenderRequest } from '../../core/integrations/document-generation/DocumentGenerationAdapter';
import {
  templateFileType,
  type TemplateFileType,
} from '../../core/integrations/document-generation/templateFileType';
import { upstreamStatusOf } from '../../core/http/httpErrorMapper';
import { env } from '../../core/config/env';
import {
  ApiErrorCodes,
  type PrintOptions,
  type StaffPrintFacts,
  type SubmissionPrintFacts,
} from '@soba/lib';
import { AppError, UnprocessableEntityError } from '../../core/errors';
import { log, getCorrelationId } from '../../core/logging';
import { readTemplateContent } from './templateContent';
import { scanUpload } from '../../core/services/scanUpload';
import { TEMPLATE_NOT_RENDERED, toRenderError } from './renderError';
import { withRenderSlot } from './renderSlots';

export interface PrintInput {
  submissionId: string;
  templateId: string;
  options?: PrintOptions;
}

/** A template the caller supplies for one print; it is not stored. */
export interface UploadedTemplate {
  content: Buffer;
  fileType: TemplateFileType;
  filename: string;
}

export interface ResolvedScope {
  workspaceId: string;
  formId: string;
  formVersionId: string;
}

/** A staff upload print, checked before its body is read. */
export interface PreparedUploadPrint {
  scope: ResolvedScope;
  submissionId: string;
  backendCode: string;
}

export type DocumentRenderOutcome =
  | { status: 'ok'; code: string; data: Buffer; contentType?: string }
  | { status: 'error'; code: string; error: unknown }
  | { status: 'notfound' }
  | { status: 'template-notfound' }
  | { status: 'template-unavailable' }
  | { status: 'denied' }
  | { status: 'unavailable' }
  | { status: 'busy' }
  | { status: 'no-content' }
  | { status: 'infected' }
  | { status: 'scan-unavailable' };

export type SubmitterPrintFactsOutcome =
  | { status: 'ok'; facts: SubmissionPrintFacts }
  | { status: 'notfound' }
  | { status: 'denied' };

export type StaffPrintFactsOutcome =
  | { status: 'ok'; facts: StaffPrintFacts }
  | { status: 'notfound' };

export type PrepareUploadOutcome =
  | { status: 'ok'; prepared: PreparedUploadPrint }
  | { status: 'notfound' }
  | { status: 'unavailable' }
  | { status: 'no-content' };

interface AuditContext {
  mode: string;
  actorId: string | null | undefined;
  submissionId: string;
  revisionId: string | null;
  templateId: string | null;
  templateFileId: string | null;
}

const submissionReader = new SubmissionService();
const maxConcurrentRenders = env.getDocumentGenerationMaxConcurrent();
const NO_SAVED_DATA = { status: 'no-content' } as const;

/**
 * The persisted answer document from the engine (the plugin shapes it for the template); null when
 * there is none. Takes the loaded record so getContent doesn't re-read it.
 */
const savedAnswers = (workspaceId: string, record: SubmissionRecord) =>
  submissionReader.getContent({ workspaceId, submissionId: record.id, record });

// PI-safe: record the error class and the upstream status (e.g. `ServiceUnavailableError
// upstream 429`), never the upstream error body, which can echo submitted answer data. The mapped
// HTTP status is captured separately.
const errorLabel = (err: unknown): string => {
  const label = err instanceof Error ? err.name : 'Error';
  const upstream = upstreamStatusOf(err);
  return upstream === undefined ? label : `${label} upstream ${upstream}`;
};

/**
 * Record one document-generation backend call (success or error). Non-blocking: a failed audit write
 * is logged and swallowed so it never fails the render. Skips when there is no actor to attribute.
 */
async function recordAudit(params: {
  audit: AuditContext;
  scope: ResolvedScope;
  backendCode: string;
  outcome: string;
  durationMs: number;
  httpStatus?: number | null;
  errorDetail?: string | null;
}): Promise<void> {
  const createdBy = params.audit.actorId;
  if (!createdBy) {
    // Shouldn't happen: both surfaces resolve an actor (the public user on submit); flag if it does.
    log.warn(
      { mode: params.audit.mode },
      'skipping document-generation audit: no actor to attribute',
    );
    return;
  }
  try {
    await createDocumentGenerationAudit({
      workspaceId: params.scope.workspaceId,
      formId: params.scope.formId,
      submissionId: params.audit.submissionId,
      mode: params.audit.mode,
      backendCode: params.backendCode,
      outcome: params.outcome,
      httpStatus: params.httpStatus,
      durationMs: params.durationMs,
      errorDetail: params.errorDetail,
      requestId: getCorrelationId() ?? null,
      templateId: params.audit.templateId,
      templateFileId: params.audit.templateFileId,
      revisionId: params.audit.revisionId,
      createdBy,
    });
  } catch (err) {
    log.error({ err }, 'failed to write document-generation audit');
  }
}

/** The audit context of a print; `stored` is null for an uploaded template. */
const printAudit = (
  record: SubmissionRecord,
  actorId: string | null | undefined,
  stored: DocumentTemplateWithFile | null,
): AuditContext => ({
  mode: DocumentGenerationMode.print,
  actorId,
  submissionId: record.id,
  revisionId: record.headRevisionId,
  templateId: stored?.template.id ?? null,
  templateFileId: stored?.file.id ?? null,
});

/**
 * Pick the document-generation backend for a scope: a granted scoped backend (e.g. cdogs-v3)
 * overrides the configured default; otherwise the default, if its own feature (when it has one) is
 * available. Null when nothing is available.
 */
async function resolveBackendCode(scope: ResolvedScope): Promise<string | null> {
  const definitions = getDocumentGenerationPluginDefinitions();
  const defaultCode = resolveDefaultDocumentGenerationCode();

  // A granted scoped backend overrides the default. With more than one scoped backend the first in
  // registration order wins — add an explicit priority before a second scoped backend is installed.
  const scopedCode = await findInOrder(definitions, async (def) => {
    if (def.code === defaultCode || !def.featureCode) return undefined;
    const gate = await getFeatureGateCached(def.featureCode, Date.now());
    if (gate?.availability !== FeatureAvailability.scoped) return undefined;
    const available = await isFeatureAvailable(def.featureCode, scope);
    return available ? def.code : undefined;
  });
  if (scopedCode) return scopedCode;

  // Fall back to the configured default — but only if it is actually installed, so a stale/typo'd
  // DOCUMENT_GENERATION_DEFAULT_CODE surfaces as unavailable rather than an adapter-lookup 500.
  const defaultDef = definitions.find((d) => d.code === defaultCode);
  if (!defaultDef) return null;
  if (!defaultDef.featureCode || (await isFeatureAvailable(defaultDef.featureCode, scope))) {
    return defaultCode;
  }
  return null;
}

/** The submission's scope, when it exists and the caller may render documents from it. */
async function renderScope(
  caller: CallerIdentity,
  submissionId: string,
): Promise<ResolvedScope | 'notfound' | 'denied'> {
  const loaded = await findSubmissionForCaller(submissionId, caller);
  if (!loaded) return 'notfound';
  if (!allowsSubmitterOperation(SubmitterOperation.render, loaded, caller)) return 'denied';
  const { workspaceId, formId, formVersionId } = loaded.submission;
  return { workspaceId, formId, formVersionId };
}

const scopeOf = (record: SubmissionRecord): ResolvedScope => ({
  workspaceId: record.workspaceId,
  formId: record.formId,
  formVersionId: record.formVersionId,
});

/** The CDOGS templates on the scope's form version, and whether a backend can render them. */
async function printFactsFor(
  scope: ResolvedScope,
): Promise<{ templates: DocumentTemplateWithFile[]; renderAvailable: boolean }> {
  const [templates, backendCode] = await Promise.all([
    listLiveDocumentTemplates(scope.formVersionId, DocumentTemplateType.cdogs),
    resolveBackendCode(scope),
  ]);
  return { templates, renderAvailable: backendCode !== null };
}

/** Call the backend once, audited: one row per call, success or error. */
async function callBackend(
  code: string,
  scope: ResolvedScope,
  request: DocumentRenderRequest,
  audit: AuditContext,
  templateId: string,
): Promise<DocumentRenderOutcome> {
  // Adapter construction, which validates config, is inside the audit boundary.
  const startedAt = Date.now();
  try {
    // Backend-agnostic: backend-specific shaping (base64 template, data flatten, CDOGS overwrite)
    // lives in the plugin.
    const result = await createDocumentGenerationAdapter(code).render(request);
    await recordAudit({
      audit,
      scope,
      backendCode: code,
      outcome: DocumentGenerationOutcome.success,
      durationMs: Date.now() - startedAt,
    });
    return { status: 'ok', code, data: result.data, contentType: result.contentType };
  } catch (err) {
    const error = toRenderError(err, { code, templateId });
    // The audit keeps the backend's mapped status and class; the caller gets the generic error.
    const audited = err instanceof AppError ? err : error;
    await recordAudit({
      audit,
      scope,
      backendCode: code,
      outcome: DocumentGenerationOutcome.error,
      durationMs: Date.now() - startedAt,
      httpStatus: audited.statusCode,
      errorDetail: errorLabel(audited),
    });
    return { status: 'error', code, error };
  }
}

/** Render the template with the answer data: backend, then the template bytes, then the call. */
async function renderWith(
  scope: ResolvedScope,
  stored: DocumentTemplateWithFile,
  body: { options?: PrintOptions; data: Record<string, unknown> },
  audit: AuditContext,
): Promise<DocumentRenderOutcome> {
  const code = await resolveBackendCode(scope);
  if (!code) return { status: 'unavailable' };

  const templateId = stored.template.id;
  const { id: fileId, profile, filename, size } = stored.file;
  const maxBytes = env.getTemplatesMaxFileSizeMb() * 1024 * 1024;
  const fileType = templateFileType(filename);
  if (!fileType || (size ?? 0) > maxBytes) {
    const reason = fileType ? 'exceeds the template size limit' : 'not a template file type';
    log.warn({ templateId, fileId, profile, reason }, 'Stored template is not renderable');
    return {
      status: 'error',
      code,
      error: new UnprocessableEntityError(TEMPLATE_NOT_RENDERED, ApiErrorCodes.render_failed),
    };
  }

  const rendered = await withRenderSlot(
    maxConcurrentRenders,
    async (): Promise<DocumentRenderOutcome> => {
      const content = await readTemplateContent(stored, maxBytes);
      if (!content) return { status: 'template-unavailable' };
      return callBackend(
        code,
        scope,
        { template: { content, fileType }, options: body.options ?? {}, data: body.data },
        audit,
        templateId,
      );
    },
  );
  return rendered === 'busy' ? { status: 'busy' } : rendered;
}

/** Render the submission's saved answers with a template stored on its form version. */
async function printStored(
  scope: ResolvedScope,
  record: SubmissionRecord,
  input: PrintInput,
  actorId: string | null | undefined,
): Promise<DocumentRenderOutcome> {
  const stored = await getLiveDocumentTemplate(
    input.templateId,
    scope.formVersionId,
    DocumentTemplateType.cdogs,
  );
  if (!stored) return { status: 'template-notfound' };

  const data = await savedAnswers(scope.workspaceId, record);
  if (!data) return NO_SAVED_DATA;

  return renderWith(
    scope,
    stored,
    { options: input.options, data },
    printAudit(record, actorId, stored),
  );
}

/** Print from the submit surface: the submitter rules decide, and only stored templates render. */
export const documentGenerationService = {
  /** The CDOGS template on the submission's form version, and whether a backend can render it. */
  async listTemplates(
    caller: CallerIdentity,
    submissionId: string,
  ): Promise<SubmitterPrintFactsOutcome> {
    const scope = await renderScope(caller, submissionId);
    if (scope === 'notfound' || scope === 'denied') return { status: scope };
    const { templates, renderAvailable } = await printFactsFor(scope);
    return {
      status: 'ok',
      facts: { items: templates.map(({ template }) => ({ id: template.id })), renderAvailable },
    };
  },

  /** Render from the submission's persisted answer data (read from the form engine). */
  async print(caller: CallerIdentity, input: PrintInput): Promise<DocumentRenderOutcome> {
    const scope = await renderScope(caller, input.submissionId);
    if (scope === 'notfound' || scope === 'denied') return { status: scope };
    const record = await getSubmissionRecordById(scope.workspaceId, input.submissionId);
    if (!record) return { status: 'notfound' };
    return printStored(scope, record, input, caller.actorId);
  },
};

/** Print from the design surface. Its routes check the caller's form permissions first. */
export const staffDocumentService = {
  /** The CDOGS templates on the submission's form version, and whether a backend can render them. */
  async listTemplates(workspaceId: string, submissionId: string): Promise<StaffPrintFactsOutcome> {
    const record = await getSubmissionRecordById(workspaceId, submissionId);
    if (!record) return { status: 'notfound' };
    const { templates, renderAvailable } = await printFactsFor(scopeOf(record));
    return {
      status: 'ok',
      facts: {
        items: templates.map(({ template, file }) => ({
          id: template.id,
          name: template.name,
          filename: file.filename,
          createdAt: file.createdAt.toISOString(),
        })),
        renderAvailable,
      },
    };
  },

  /** Render from the submission's persisted answer data (read from the form engine). */
  async print(
    workspaceId: string,
    actorId: string,
    input: PrintInput,
  ): Promise<DocumentRenderOutcome> {
    const record = await getSubmissionRecordById(workspaceId, input.submissionId);
    if (!record) return { status: 'notfound' };
    return printStored(scopeOf(record), record, input, actorId);
  },

  /** What an upload print needs before its body is read: the submission, saved answers, a backend. */
  async prepareUpload(workspaceId: string, submissionId: string): Promise<PrepareUploadOutcome> {
    const record = await getSubmissionRecordById(workspaceId, submissionId);
    if (!record) return { status: 'notfound' };
    if (!record.engineSubmissionRef) return NO_SAVED_DATA;
    const scope = scopeOf(record);
    const backendCode = await resolveBackendCode(scope);
    if (!backendCode) return { status: 'unavailable' };
    return { status: 'ok', prepared: { scope, submissionId, backendCode } };
  },

  /** Render the saved answers with an uploaded template. The caller already holds a render slot. */
  async printUpload(
    prepared: PreparedUploadPrint,
    template: UploadedTemplate,
    options: PrintOptions,
    actorId: string,
  ): Promise<DocumentRenderOutcome> {
    // The bytes are never stored, so scan them here as an upload would be.
    const scan = await scanUpload(template.content, template.filename);
    if (scan !== 'clean') return { status: scan };

    // Read again: the submission can change while the body uploads.
    const { scope, submissionId, backendCode } = prepared;
    const record = await getSubmissionRecordById(scope.workspaceId, submissionId);
    if (!record) return { status: 'notfound' };
    const data = await savedAnswers(scope.workspaceId, record);
    if (!data) return NO_SAVED_DATA;

    return callBackend(
      backendCode,
      scope,
      { template: { content: template.content, fileType: template.fileType }, options, data },
      printAudit(record, actorId, null),
      'inline',
    );
  },
};
