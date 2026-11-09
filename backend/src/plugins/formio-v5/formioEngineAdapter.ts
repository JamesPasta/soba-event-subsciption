import {
  FormEngineAdapter,
  type CreateSubmissionInput,
  type FormEngineReadinessResult,
  type ReadSubmissionsOptions,
  type ReadSubmissionsResult,
  type UpsertSchemaInput,
} from '../../core/integrations/form-engine/FormEngineAdapter';
import { PluginConfigReader } from '../../core/config/pluginConfig';
import { InternalError, ValidationError } from '../../core/errors';
import { mapInOrder } from '../../core/inOrder';
import {
  getAuthenticatedFormioClient,
  isFormioNotFound,
  type FormioCommunityEditionAPIv5Client,
  type FormioQuery,
} from './formioV5Client';
import { ApiErrorCodes, normalizeSchema as normalizeFormioSchema } from '@soba/lib';

/**
 * The read's result. A document SOBA refers to that Form.io no longer has is an inconsistency, not
 * an empty read, so it fails with engine_document_missing.
 */
const missingAsError = async <T>(read: Promise<T>): Promise<T> => {
  try {
    return await read;
  } catch (err) {
    if (isFormioNotFound(err)) {
      throw new InternalError(
        'Form engine document is missing',
        ApiErrorCodes.engine_document_missing,
      );
    }
    throw err;
  }
};

export interface FormioV5Config {
  apiBaseUrl: string;
  adminApiUrl: string;
  renderApiUrl: string;
  adminUsername: string;
  adminPassword: string;
  projectPath?: string;
  version?: string;
}

const loadConfig = (config: PluginConfigReader): FormioV5Config => {
  return {
    apiBaseUrl: config.getRequired('API_BASE_URL'),
    adminApiUrl: config.getRequired('ADMIN_API_URL'),
    renderApiUrl: config.getRequired('RENDER_API_URL'),
    adminUsername: config.getRequired('ADMIN_USERNAME'),
    adminPassword: config.getRequired('ADMIN_PASSWORD'),
    projectPath: config.getOptional('PROJECT_PATH'),
    version: config.getOptional('VERSION'),
  };
};

/** Deterministic Form.io identity for a SOBA form version (unique per project; the idempotency key). */
const sobaEngineName = (formVersionId: string): string => `soba-${formVersionId}`;

/** Normalize an existing `tags` value (array or comma-separated string) to trimmed candidate tokens. */
function extractTagCandidates(existing: unknown): string[] {
  if (Array.isArray(existing)) {
    return existing.map((t) => (t == null ? '' : String(t).trim()));
  }
  if (typeof existing === 'string') {
    return existing.split(',').map((part) => part.trim());
  }
  return [];
}

/** Tenancy tags: always include `soba` and the workspace id; preserve any existing tags. */
function mergeSobaWorkspaceTags(existing: unknown, workspaceId: string): string[] {
  const out = new Set<string>(['soba', workspaceId]);
  for (const candidate of extractTagCandidates(existing)) {
    if (candidate) out.add(candidate);
  }
  return [...out];
}

const ENGINE_REJECTIONS = {
  schema: { subject: 'the schema', code: ApiErrorCodes.engine_schema_rejected },
  data: { subject: 'the submission data', code: ApiErrorCodes.engine_data_rejected },
} as const;

/**
 * Map a Form.io rejection that carries a 4xx status into a coded ValidationError (HTTP 400), so a
 * rejected schema or submission surfaces as a client error rather than a 500. Re-throws anything
 * else (network/5xx) unchanged.
 */
const rethrowEngineRejection =
  (what: keyof typeof ENGINE_REJECTIONS) =>
  (err: unknown): never => {
    const status =
      typeof err === 'object' && err !== null && 'status' in err
        ? Number((err as { status: unknown }).status)
        : Number.NaN;
    if (Number.isFinite(status) && status >= 400 && status < 500) {
      const { subject, code } = ENGINE_REJECTIONS[what];
      const detail = err instanceof Error && err.message ? `: ${err.message}` : '';
      throw new ValidationError(`Form engine rejected ${subject}${detail}`, code);
    }
    throw err;
  };

/** Deletes a form document; one already gone counts as deleted. */
const deleteFormIfPresent = async (
  client: FormioCommunityEditionAPIv5Client,
  formId: string,
  signal?: AbortSignal,
): Promise<void> => {
  try {
    await client.deleteForm(formId, signal);
  } catch (err) {
    if (!isFormioNotFound(err)) throw err;
  }
};

/** Form.io-managed identity/audit fields the client must never set (write) or receive (read). */
const ENGINE_MANAGED_FIELDS = ['_id', 'machineName', 'created', 'modified', 'owner', 'project'];

/** Remove engine-managed fields from a schema document (returns a shallow clone). */
export function stripEngineManagedFields(doc: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = { ...doc };
  for (const key of ENGINE_MANAGED_FIELDS) {
    delete cleaned[key];
  }
  return cleaned;
}

/** A submission without engine fields and SOBA `metadata`. */
const answerDocument = (doc: Record<string, unknown>): Record<string, unknown> => {
  const cleaned = stripEngineManagedFields(doc);
  delete cleaned.metadata;
  return cleaned;
};

/** Submissions read per Form.io list call. */
const READ_BATCH_SIZE = 100;

/** Without `full`, Form.io's list shortens signature answers to "YES" and drops base64 file urls. */
const batchQuery = (refs: string[], full: boolean): FormioQuery => ({
  params: { _id__in: refs.join(','), limit: refs.length, ...(full ? { full: true } : {}) },
});

/**
 * Fields the renderer reads when filling: page or wizard display, form settings, the components
 * with their validation, the submit action, and the form properties (number separators, wizard
 * button order). Name, path, title, tags and access identify or describe the stored document; a
 * component template that reads one of them sees a change the hash does not.
 */
const RENDERED_FIELDS = ['display', 'settings', 'components', 'action', 'properties'];

/** Properties buildSchemaBody writes onto every stored form, naming its workspace and version. */
const SOBA_PROPERTIES = new Set(['soba_workspace_id', 'soba_form_version_id']);

/** The form's own properties, without SOBA's; undefined when none are left. */
const ownProperties = (value: unknown): unknown => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  const own = Object.entries(value).filter(([key]) => !SOBA_PROPERTIES.has(key));
  return own.length > 0 ? Object.fromEntries(own) : undefined;
};

/** The rendered fields of a Form.io form document, without the properties SOBA adds. */
export function renderedFormioSchema(doc: Record<string, unknown>): Record<string, unknown> {
  const rendered: Record<string, unknown> = {};
  for (const key of RENDERED_FIELDS) {
    const value = key === 'properties' ? ownProperties(doc.properties) : doc[key];
    if (value !== undefined) rendered[key] = value;
  }
  return rendered;
}

/** Build the Form.io form document for an upsert: strip engine-managed fields, then apply
 *  deterministic identity + SOBA tenancy metadata. */
export function buildSchemaBody(input: UpsertSchemaInput): Record<string, unknown> {
  const base = stripEngineManagedFields(
    structuredClone(input.schema ?? {}) as Record<string, unknown>,
  );
  const name = sobaEngineName(input.formVersionId);

  const prevProps =
    typeof base.properties === 'object' &&
    base.properties !== null &&
    !Array.isArray(base.properties)
      ? (base.properties as Record<string, unknown>)
      : {};

  const title =
    input.title?.trim() || (typeof base.title === 'string' && base.title.trim()) || 'Form';

  return {
    ...base,
    name,
    path: name,
    title,
    properties: {
      ...prevProps,
      soba_workspace_id: input.workspaceId,
      soba_form_version_id: input.formVersionId,
    },
    tags: mergeSobaWorkspaceTags(base.tags, input.workspaceId),
  };
}

/**
 * Form.io strips submission `data` keys that aren't form components, so SOBA correlation fields live
 * in submission `metadata` (preserved intact). The revision id is a string Form.io can filter on, so
 * it is also the idempotency key.
 */
const SOBA_REVISION_ID_FIELD = 'soba_revision_id';

/** Build the Form.io submission document for a create: the answer data plus SOBA correlation/tenancy
 *  metadata. */
export function buildSubmissionBody(input: CreateSubmissionInput): Record<string, unknown> {
  const answers =
    typeof input.data === 'object' && input.data !== null && !Array.isArray(input.data)
      ? (structuredClone(input.data) as Record<string, unknown>)
      : {};
  return {
    data: answers,
    metadata: {
      soba_workspace_id: input.workspaceId,
      soba_submission_id: input.submissionId,
      [SOBA_REVISION_ID_FIELD]: input.revisionId,
    },
  };
}

export class FormioEngineAdapter implements FormEngineAdapter {
  private readonly config: FormioV5Config;
  private readonly pluginConfig: PluginConfigReader;

  constructor(pluginConfig: PluginConfigReader) {
    this.pluginConfig = pluginConfig;
    this.config = loadConfig(pluginConfig);
  }

  async readinessCheck(): Promise<FormEngineReadinessResult> {
    try {
      const url = this.config.renderApiUrl.replace(/\/$/, '') || this.config.renderApiUrl;
      const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(5000) });
      if (res.ok || res.status === 404) {
        return { ok: true };
      }
      return { ok: false, message: `HTTP ${res.status}` };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Idempotent create-or-update of the Form.io document for a form version, keyed by the
   * deterministic name `soba-{formVersionId}`. Retries converge on a single document.
   */
  async upsertSchema(input: UpsertSchemaInput): Promise<{ engineRef: string }> {
    const client = await getAuthenticatedFormioClient(this.pluginConfig);
    if (!client) {
      throw new Error('Form.io admin client unavailable; cannot upsert form schema');
    }

    const body = buildSchemaBody(input);
    const name = sobaEngineName(input.formVersionId);

    // Find existing documents by the deterministic name so a retry updates instead of duplicating.
    const findIds = async (): Promise<string[]> => {
      const found = (await client.loadForms({ params: { name } }, input.signal)) as Array<
        Record<string, unknown>
      >;
      return found.map((doc) => doc._id).filter((id): id is string => typeof id === 'string');
    };
    const found = await findIds();
    const existingId =
      input.engineRef && found.includes(input.engineRef) ? input.engineRef : found[0];
    if (input.engineRef) {
      // Overlapping creates can each leave a document with the name, and Form.io refuses a name
      // another document has.
      await Promise.all(
        found
          .filter((id) => id !== existingId)
          .map((id) => deleteFormIfPresent(client, id, input.signal)),
      );
    }
    if (existingId) {
      body._id = existingId;
    }

    let saved: Record<string, unknown> | null;
    try {
      saved = (await client.saveForm(body, input.signal)) as Record<string, unknown> | null;
    } catch (err) {
      // A concurrent write for the same version created the document first: update that one.
      const createdId = existingId ? undefined : (await findIds())[0];
      if (!createdId) rethrowEngineRejection('schema')(err);
      saved = (await client
        .saveForm({ ...body, _id: createdId }, input.signal)
        .catch(rethrowEngineRejection('schema'))) as Record<string, unknown> | null;
    }
    const engineRef = saved?._id;
    if (typeof engineRef !== 'string' || engineRef === '') {
      throw new Error('Form.io saveForm did not return an _id');
    }
    return { engineRef };
  }

  /**
   * Read the Form.io document by engine ref, stripped of engine-managed fields. A document Form.io
   * no longer has fails with engine_document_missing.
   */
  async readSchema(engineRef: string): Promise<Record<string, unknown> | null> {
    const client = await getAuthenticatedFormioClient(this.pluginConfig);
    if (!client) {
      throw new Error('Form.io admin client unavailable; cannot read form schema');
    }
    const doc = (await missingAsError(client.loadForm(engineRef))) as Record<
      string,
      unknown
    > | null;
    return doc ? stripEngineManagedFields(doc) : null;
  }

  /** Delete the Form.io document by engine ref (compensation / cleanup). */
  async deleteSchema(engineRef: string): Promise<void> {
    const client = await getAuthenticatedFormioClient(this.pluginConfig);
    if (!client) {
      throw new Error('Form.io admin client unavailable; cannot delete form schema');
    }
    await client.deleteForm(engineRef);
  }

  /** Normalize a schema (import or export) to a clean, portable, builder-ready form definition. */
  normalizeSchema(schema: Record<string, unknown>): Record<string, unknown> {
    return normalizeFormioSchema(schema);
  }

  /** What the renderer reads from a stored form document. */
  renderedSchema(schema: Record<string, unknown>): Record<string, unknown> {
    return renderedFormioSchema(schema);
  }

  /**
   * Create a new Form.io submission document under the form `engineFormRef`. Idempotent per
   * revision id: a retried write for the same revision finds the existing document rather than
   * creating a duplicate.
   */
  async createSubmission(input: CreateSubmissionInput): Promise<{ engineRef: string }> {
    const client = await getAuthenticatedFormioClient(this.pluginConfig);
    if (!client) {
      throw new Error('Form.io admin client unavailable; cannot create submission');
    }

    const existing = (await client.loadSubmissions(input.engineFormRef, {
      params: { [`metadata.${SOBA_REVISION_ID_FIELD}`]: input.revisionId },
    })) as Array<Record<string, unknown>>;
    const existingRef = existing[0]?._id;
    if (typeof existingRef === 'string' && existingRef !== '') {
      return { engineRef: existingRef };
    }

    const body = buildSubmissionBody(input);
    // Form.io validates every submission, drafts included; only an admin's noValidate skips it.
    const query = input.validate ? undefined : { params: { noValidate: true } };
    const saved = (await client
      .saveSubmission(input.engineFormRef, body, query)
      .catch(rethrowEngineRejection('data'))) as Record<string, unknown> | null;
    const engineRef = saved?._id;
    if (typeof engineRef !== 'string' || engineRef === '') {
      throw new Error('Form.io saveSubmission did not return an _id');
    }
    return { engineRef };
  }

  /** Read a Form.io submission by form ref + submission ref, stripped of engine-managed fields and
   *  the SOBA correlation `metadata` (internal bookkeeping, not answer content). A document Form.io
   *  no longer has fails with engine_document_missing. */
  async readSubmission(
    engineFormRef: string,
    engineRef: string,
  ): Promise<Record<string, unknown> | null> {
    const client = await getAuthenticatedFormioClient(this.pluginConfig);
    if (!client) {
      throw new Error('Form.io admin client unavailable; cannot read submission');
    }
    const doc = (await missingAsError(client.loadSubmission(engineFormRef, engineRef))) as Record<
      string,
      unknown
    > | null;
    return doc ? answerDocument(doc) : null;
  }

  /**
   * Many submissions of one form, in `_id__in` batches run one after another. A form Form.io no
   * longer has fails with engine_document_missing; a ref that is not a Form.io id fails the read.
   */
  async readSubmissions(
    engineFormRef: string,
    engineRefs: string[],
    signal?: AbortSignal,
    { full = false }: ReadSubmissionsOptions = {},
  ): Promise<ReadSubmissionsResult> {
    if (engineRefs.length === 0) return { found: new Map(), missing: [] };
    const client = await getAuthenticatedFormioClient(this.pluginConfig);
    if (!client) {
      throw new Error('Form.io admin client unavailable; cannot read submissions');
    }
    const batches: string[][] = [];
    for (let start = 0; start < engineRefs.length; start += READ_BATCH_SIZE) {
      batches.push(engineRefs.slice(start, start + READ_BATCH_SIZE));
    }
    const pages = await mapInOrder(batches, (refs) =>
      missingAsError(client.loadSubmissions(engineFormRef, batchQuery(refs, full), signal)),
    );
    const found = new Map<string, Record<string, unknown>>(
      pages.flat().map((doc) => [doc._id, answerDocument(doc)]),
    );
    return { found, missing: engineRefs.filter((ref) => !found.has(ref)) };
  }

  /** Delete a Form.io submission by form ref + submission ref (compensation / cleanup). */
  async deleteSubmission(engineFormRef: string, engineRef: string): Promise<void> {
    const client = await getAuthenticatedFormioClient(this.pluginConfig);
    if (!client) {
      throw new Error('Form.io admin client unavailable; cannot delete submission');
    }
    await client.deleteSubmission(engineFormRef, engineRef);
  }
}
