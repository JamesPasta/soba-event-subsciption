import { v7 as uuidv7 } from 'uuid';
import { newFormSchema } from '@soba/lib';
import {
  FormVersionListSort,
  appendFormVersionRevision,
  createFormVersionDraft,
  findFormVersionAnywhere,
  finishFormVersionProvisioning,
  getCurrentFormVersion,
  getFormVersionById,
  getFormVersionByIdIncludingDeleted,
  getPublishedVersionForForm,
  listFormVersionsForWorkspace,
  lockFormVersion,
  lookupFormVersions,
  updateFormVersionDraft,
  type FormVersionRecord,
  type LookupFormVersionsInput,
} from '../db/repos/formVersionRepo';
import { getFormById, getFormEngineCodeForForm } from '../db/repos/formRepo';
import { copyDocumentTemplates } from '../db/repos/documentTemplateRepo';
import type { FormAccessGrant } from '../db/repos/formAccessRepo';
import { db, type DbOrTx } from '../db/client';
import { hasPgCode, isUniqueViolationOn, PG_UNIQUE_VIOLATION } from '../db/pgError';
import { FORM_VERSION_ONE_PUBLISHED_UNIQUE, FORM_VERSION_PKEY } from '../db/schema';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { FORM_VERSION_ID_TAKEN, SOURCE_VERSION_HAS_NO_SCHEMA } from '../messages';
import {
  discardLostEngineSchema,
  hashEngineSchema,
  readEngineSchema,
  schemaWriterFor,
  writeEngineSchema,
} from './engineSchema';

const FORM_VERSION_NOT_FOUND = 'Form version not found';

/**
 * Runs `write` with the version row locked, once the version is confirmed as its form's current
 * version. The check and the write share the lock, so a publish of the same version cannot land
 * between them.
 */
function withCurrentVersion<T>(
  input: { workspaceId: string; formVersionId: string },
  write: (version: FormVersionRecord, tx: DbOrTx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const version = await lockFormVersion(input.workspaceId, input.formVersionId, tx);
    if (!version) throw new NotFoundError(FORM_VERSION_NOT_FOUND);

    const current = await getCurrentFormVersion(input.workspaceId, version.formId, tx);
    if (current?.id !== version.id) {
      throw new ConflictError('Form version is not the current version of its form');
    }
    return write(version, tx);
  });
}

/** A provision this old is taken to have died, and no longer blocks the version. */
const PROVISIONING_STALE_MS = 2 * 60 * 1000;
/** A provision's engine calls are abandoned by then, before its claim can go stale. */
const PROVISIONING_BUDGET_MS = 90 * 1000;

/**
 * Only a draft's schema is written, and not while another save is still writing it: the engine
 * call runs after the lock is released.
 */
function assertSchemaWritable(version: FormVersionRecord): void {
  if (version.state !== 'draft') {
    throw new ConflictError('Form version is not a draft');
  }
  if (
    version.engineSyncStatus === 'provisioning' &&
    Date.now() - version.updatedAt.getTime() < PROVISIONING_STALE_MS
  ) {
    throw new ConflictError('Form version schema is already being saved');
  }
}

interface CreateDraftInput {
  /** Minted by the caller, so a retried create returns the draft the first one made. */
  id?: string;
  workspaceId: string;
  actorId: string;
  actorDisplayLabel: string | null;
  formId: string;
  /** The version whose document templates the draft gets. */
  fromFormVersionId?: string;
  /** The draft's schema; when absent, the source version's, else the default form. */
  schema?: Record<string, unknown>;
}

interface SaveInput {
  workspaceId: string;
  actorId: string;
  actorDisplayLabel: string | null;
  formVersionId: string;
  note?: string;
}

interface VersionActionInput {
  workspaceId: string;
  actorId: string;
  actorDisplayLabel: string | null;
  formVersionId: string;
}

interface ListInput {
  workspaceIds: string[];
  actorId: string;
  formAccess: FormAccessGrant;
  offset: number;
  limit: number;
  formId?: string;
  formVersionId?: string;
  state?: string;
  sort: FormVersionListSort;
}

type LifecycleState = 'draft' | 'published' | 'archived' | 'deleted';

const ALLOWED_TRANSITIONS: Record<LifecycleState, LifecycleState[]> = {
  draft: ['published', 'deleted'],
  published: ['archived', 'deleted'],
  archived: ['published', 'deleted'],
  deleted: [],
};

/** Throws if a form version may not move from `from` to `to`. */
function assertTransition(from: string, to: LifecycleState): void {
  const allowed = ALLOWED_TRANSITIONS[from as LifecycleState] ?? [];
  if (!allowed.includes(to)) {
    throw new ValidationError(`Cannot change form version state from '${from}' to '${to}'`);
  }
}

/**
 * Stamp patch for a target state: sets the matching timestamp/actor columns and nulls the rest,
 * so the stamps always match `state` (only `published` has publishedAt/By, only `deleted` has deletedAt/By).
 */
function stateStamps(
  to: LifecycleState,
  actor: { actorId: string; actorDisplayLabel: string | null },
): {
  state: LifecycleState;
  publishedAt: Date | null;
  publishedBy: string | null;
  deletedAt: Date | null;
  deletedBy: string | null;
} {
  const patch = {
    state: to,
    publishedAt: null as Date | null,
    publishedBy: null as string | null,
    deletedAt: null as Date | null,
    deletedBy: null as string | null,
  };
  if (to === 'published') {
    patch.publishedAt = new Date();
    patch.publishedBy = actor.actorId;
  } else if (to === 'deleted') {
    patch.deletedAt = new Date();
    patch.deletedBy = actor.actorDisplayLabel;
  }
  return patch;
}

export class FormVersionService {
  /** Creates a draft with its schema; a retry with the same id returns the draft it made. */
  async createDraft(
    input: CreateDraftInput,
  ): Promise<{ version: FormVersionRecord; created: boolean }> {
    const existing = input.id ? await this.findCreatedDraft(input, input.id) : null;
    if (existing) return { version: existing, created: false };

    const form = await getFormById(input.workspaceId, input.formId);
    if (!form) throw new NotFoundError('Form not found');
    const source = input.fromFormVersionId
      ? await getFormVersionById(input.workspaceId, input.fromFormVersionId)
      : null;
    if (input.fromFormVersionId && source?.formId !== input.formId) {
      throw new ValidationError('fromFormVersionId is not a version of this form');
    }

    const id = input.id ?? uuidv7();
    // Written before the row, so a version is never committed without its document.
    const engineSchemaRef = await writeEngineSchema({
      engineCode: form.formEngineCode,
      formVersionId: id,
      workspaceId: input.workspaceId,
      schema: await this.draftSchema(input.schema, form.formEngineCode, source),
      title: form.name,
    });

    try {
      const version = await db.transaction(async (tx) => {
        const draft = await createFormVersionDraft(
          {
            id,
            workspaceId: input.workspaceId,
            formId: input.formId,
            actorId: input.actorId,
            actorDisplayLabel: input.actorDisplayLabel,
            engineSchemaRef,
          },
          tx,
        );
        if (source) await copyDocumentTemplates(tx, source.id, draft.id, input.actorId);
        return draft;
      });
      return { version, created: true };
    } catch (err) {
      // A concurrent create with the same id committed first.
      if (input.id && hasPgCode(err, [PG_UNIQUE_VIOLATION])) {
        const replay = await this.findCreatedDraft(input, input.id);
        if (replay) {
          await discardLostEngineSchema(form.formEngineCode, replay, engineSchemaRef);
          return { version: replay, created: false };
        }
      }
      if (isUniqueViolationOn(err, FORM_VERSION_PKEY)) {
        throw new ConflictError(FORM_VERSION_ID_TAKEN);
      }
      throw err;
    }
  }

  /** The schema a new draft starts from: the one sent, else the source version's, else the default. */
  private async draftSchema(
    sent: Record<string, unknown> | undefined,
    engineCode: string,
    source: FormVersionRecord | null,
  ): Promise<Record<string, unknown>> {
    if (sent) return sent;
    if (!source) return newFormSchema();
    const copied = await readEngineSchema(engineCode, source.engineSchemaRef);
    // A version that never got a schema has nothing to copy, and the default form would pass for it.
    if (!copied) throw new ConflictError(SOURCE_VERSION_HAS_NO_SCHEMA);
    return copied;
  }

  /**
   * The draft a create with this id already made, or null when the id is unused. A 409 when the id
   * belongs to another form or a deleted version.
   */
  private async findCreatedDraft(
    input: CreateDraftInput,
    id: string,
  ): Promise<FormVersionRecord | null> {
    const found = await findFormVersionAnywhere(id);
    if (!found) return null;
    if (
      found.workspaceId !== input.workspaceId ||
      found.formId !== input.formId ||
      found.deletedAt
    ) {
      throw new ConflictError(FORM_VERSION_ID_TAKEN);
    }
    // Null only when the version was deleted since the read above.
    const version = await getFormVersionById(input.workspaceId, id);
    if (!version) throw new ConflictError(FORM_VERSION_ID_TAKEN);
    return version;
  }

  async save(input: SaveInput) {
    const updated = await withCurrentVersion(input, async (locked, tx) => {
      assertSchemaWritable(locked);
      return appendFormVersionRevision(
        {
          workspaceId: input.workspaceId,
          formVersionId: input.formVersionId,
          actorId: input.actorId,
          actorDisplayLabel: input.actorDisplayLabel,
          eventType: 'save_draft',
          changeNote: input.note,
        },
        tx,
      );
    });

    if (!updated) throw new NotFoundError(FORM_VERSION_NOT_FOUND);

    return updated;
  }

  async delete(input: VersionActionInput) {
    const version = await getFormVersionByIdIncludingDeleted(
      input.workspaceId,
      input.formVersionId,
    );
    if (!version) throw new NotFoundError(FORM_VERSION_NOT_FOUND);
    assertTransition(version.state, 'deleted');
    return updateFormVersionDraft(
      input.workspaceId,
      input.formVersionId,
      input.actorDisplayLabel,
      stateStamps('deleted', input),
    );
  }

  async publish(input: VersionActionInput) {
    return withCurrentVersion(input, async (version, tx) => {
      if (version.state === 'published') return version; // idempotent
      assertTransition(version.state, 'published');
      if (version.engineSyncStatus !== 'ready') {
        throw new ValidationError('Form version is not ready to publish');
      }
      const incumbent = await getPublishedVersionForForm(input.workspaceId, version.formId, tx);
      if (incumbent && incumbent.id !== version.id) {
        await updateFormVersionDraft(
          input.workspaceId,
          incumbent.id,
          input.actorDisplayLabel,
          stateStamps('archived', input),
          tx,
        );
      }
      try {
        return await updateFormVersionDraft(
          input.workspaceId,
          input.formVersionId,
          input.actorDisplayLabel,
          stateStamps('published', input),
          tx,
        );
      } catch (err) {
        // Another version of the form was published concurrently.
        if (isUniqueViolationOn(err, FORM_VERSION_ONE_PUBLISHED_UNIQUE)) {
          throw new ConflictError('Another version of this form was published at the same time');
        }
        throw err;
      }
    });
  }

  async unpublish(input: VersionActionInput) {
    const version = await getFormVersionById(input.workspaceId, input.formVersionId);
    if (!version) throw new NotFoundError(FORM_VERSION_NOT_FOUND);
    assertTransition(version.state, 'archived');
    return updateFormVersionDraft(
      input.workspaceId,
      input.formVersionId,
      input.actorDisplayLabel,
      stateStamps('archived', input),
    );
  }

  /**
   * Provision (create-or-update) the form version's schema in the form engine, server-side via the
   * admin client. Sets engineSyncStatus 'provisioning' → 'ready' (with engineSchemaRef) or 'error'.
   */
  async provision(input: {
    workspaceId: string;
    actorId: string;
    actorDisplayLabel: string | null;
    formVersionId: string;
    schema: Record<string, unknown>;
  }) {
    // The engine document is updated in place, so writing a published version changes the live form.
    const claim = await withCurrentVersion(input, async (locked, tx) => {
      assertSchemaWritable(locked);

      const engineCode = await getFormEngineCodeForForm(input.workspaceId, locked.formId);
      if (!engineCode) {
        throw new ValidationError('Form has no form engine configured');
      }
      // Resolved before the claim, so an engine that cannot write schemas claims nothing.
      const upsertSchema = schemaWriterFor(engineCode);
      const form = await getFormById(input.workspaceId, locked.formId);

      const claimed = await updateFormVersionDraft(
        input.workspaceId,
        input.formVersionId,
        input.actorDisplayLabel,
        { engineSyncStatus: 'provisioning', engineSyncError: null },
        tx,
      );
      if (!claimed) throw new NotFoundError(FORM_VERSION_NOT_FOUND);
      return {
        upsertSchema,
        title: form?.name,
        engineRef: locked.engineSchemaRef ?? undefined,
        claimedAt: claimed.updatedAt,
      };
    });

    let engineRef: string;
    try {
      ({ engineRef } = await claim.upsertSchema({
        formVersionId: input.formVersionId,
        workspaceId: input.workspaceId,
        schema: input.schema,
        title: claim.title,
        engineRef: claim.engineRef,
        signal: AbortSignal.timeout(PROVISIONING_BUDGET_MS),
      }));
    } catch (err) {
      await finishFormVersionProvisioning(
        input.workspaceId,
        input.formVersionId,
        input.actorDisplayLabel,
        claim.claimedAt,
        {
          engineSyncStatus: 'error',
          engineSyncError: err instanceof Error ? err.message : String(err),
        },
      );
      throw err;
    }

    const finished = await finishFormVersionProvisioning(
      input.workspaceId,
      input.formVersionId,
      input.actorDisplayLabel,
      claim.claimedAt,
      { engineSchemaRef: engineRef, engineSyncStatus: 'ready', engineSyncError: null },
    );
    // Another save took the version over after this one's stale window, or it stopped being a draft.
    if (!finished) {
      throw new ConflictError('Form version changed while its schema was being saved');
    }
    return finished;
  }

  /** Reads the form version's schema back from the form engine (null if unprovisioned). */
  async getSchema(input: { workspaceId: string; formVersionId: string }) {
    const version = await getFormVersionById(input.workspaceId, input.formVersionId);
    if (!version) return null;
    return this.getSchemaForVersion(version);
  }

  /** As getSchema, but for an already-loaded version row — skips the re-fetch by id. */
  async getSchemaForVersion(version: {
    workspaceId: string;
    formId: string;
    engineSchemaRef: string | null;
  }) {
    if (!version.engineSchemaRef) return null;

    const engineCode = await getFormEngineCodeForForm(version.workspaceId, version.formId);
    if (!engineCode) return null;

    return this.readSchema({ engineCode, engineSchemaRef: version.engineSchemaRef });
  }

  /** Reads a schema from the engine by its ref; null when there is nothing to read. */
  async readSchema(refs: { engineCode: string; engineSchemaRef: string | null }) {
    return readEngineSchema(refs.engineCode, refs.engineSchemaRef);
  }

  /** A hash of what the engine renders from the schema; its stored identity does not count. */
  schemaHash(input: { engineCode: string; schema: Record<string, unknown> }): string {
    return hashEngineSchema(input.engineCode, input.schema);
  }

  async get(workspaceId: string, formVersionId: string) {
    return getFormVersionById(workspaceId, formVersionId);
  }

  async list(input: ListInput) {
    return listFormVersionsForWorkspace(input);
  }

  async lookup(input: LookupFormVersionsInput) {
    return lookupFormVersions(input);
  }

  async getCurrent(workspaceId: string, formId: string) {
    return getCurrentFormVersion(workspaceId, formId);
  }
}
