import { v7 as uuidv7 } from 'uuid';
import { newFormSchema, type CreateFormSettings, type SortLocale } from '@soba/lib';
import {
  createForm,
  FormRecord,
  FormListSort,
  findFormAnywhere,
  formNameExistsInWorkspace,
  getFormById,
  listFormsForWorkspace,
  markFormDeleted,
  updateForm,
  getFormByEngineSchemaRef,
} from '../db/repos/formRepo';
import { listFormsForSubmitter, type ListSubmitterFormsInput } from '../db/repos/submitterFormRepo';
import {
  createFormVersionDraft,
  findFormVersionAnywhere,
  getFormVersionById,
  type FormVersionRecord,
} from '../db/repos/formVersionRepo';
import type { FormAccessGrant } from '../db/repos/formAccessRepo';
import { isWorkspaceDisclaimerAccepted } from '../db/repos/workspaceRepo';
import { db } from '../db/client';
import { hasPgCode, isUniqueViolationOn, PG_UNIQUE_VIOLATION } from '../db/pgError';
import { FORM_PKEY, FORM_VERSION_PKEY, FORM_WORKSPACE_NAME_UNIQUE } from '../db/schema';
import { env } from '../config/env';
import {
  createFormEngineAdapter,
  getFormEnginePlugins,
  resolveFormEnginePlugin,
} from '../integrations/form-engine/FormEngineRegistry';
import { ConflictError, ValidationError } from '../errors';
import { FORM_ID_TAKEN, FORM_NAME_TAKEN, FORM_VERSION_ID_TAKEN } from '../messages';
import { createFormSettings } from '../../features/form-settings/create';
import { discardLostEngineSchema, writeEngineSchema } from './engineSchema';

interface DeleteInput {
  workspaceId: string;
  actorId: string;
  actorDisplayLabel: string | null;
  formId: string;
}

interface ListInput {
  workspaceIds: string[];
  actorId: string;
  formAccess: FormAccessGrant;
  offset: number;
  limit: number;
  formId?: string;
  q?: string;
  status?: string;
  sort: FormListSort;
  locale: SortLocale;
}

interface CreateInput {
  /** Minted by the caller, so a retried create returns the form the first one made. */
  id?: string;
  /** Minted by the caller for the form's first version; sent with `id`. */
  versionId?: string;
  workspaceId: string;
  actorId: string;
  actorDisplayLabel: string | null;
  name: string;
  description?: string;
  formEngineCode?: string;
  /** The first version's schema; the default form when absent. */
  schema?: Record<string, unknown>;
  /** Settings the form starts with instead of inheriting its workspace's. */
  settings?: CreateFormSettings;
}

interface PreparedForm {
  formId: string;
  versionId: string;
  engineCode: string;
  /** The first version's engine document, written before the rows. */
  engineSchemaRef: string;
}

interface CreatedForm {
  form: FormRecord;
  version: FormVersionRecord;
  /** False when a retried create returned the form the first one made. */
  created: boolean;
}

interface UpdateInput {
  workspaceId: string;
  actorId: string;
  actorDisplayLabel: string | null;
  formId: string;
  name?: string;
  description?: string | null;
  org?: string;
  useCase?: string;
  status?: string;
}

export class FormService {
  async create(input: CreateInput): Promise<CreatedForm> {
    // A retry returns before the checks, which the form it made would fail.
    const existing = input.id ? await this.findCreated(input, input.id) : null;
    if (existing) return existing;
    let prepared: PreparedForm | undefined;
    try {
      prepared = await this.prepareNew(input);
      return await this.commitNew(input, prepared);
    } catch (err) {
      const replay = await this.answerRefusedCreate(err, input);
      if (prepared) {
        await discardLostEngineSchema(
          prepared.engineCode,
          replay.version,
          prepared.engineSchemaRef,
        );
      }
      return replay;
    }
  }

  /** Checks the create, then writes the first version's engine document. */
  private async prepareNew(input: CreateInput): Promise<PreparedForm> {
    // Gate: the workspace disclaimer must be accepted before any form can be created.
    if (!(await isWorkspaceDisclaimerAccepted(input.workspaceId))) {
      throw new ConflictError('Accept the workspace disclaimer before creating forms');
    }
    const engineCode = this.resolveEngineCode(input.formEngineCode);

    if (await formNameExistsInWorkspace(input.workspaceId, input.name)) {
      throw new ConflictError(FORM_NAME_TAKEN);
    }
    // Checked before the engine write, which would otherwise update another version's document.
    if (input.versionId && (await findFormVersionAnywhere(input.versionId))) {
      throw new ConflictError(FORM_VERSION_ID_TAKEN);
    }

    const versionId = input.versionId ?? uuidv7();
    // Written before the rows, so a version is never committed without its document.
    const engineSchemaRef = await writeEngineSchema({
      engineCode,
      formVersionId: versionId,
      workspaceId: input.workspaceId,
      schema: input.schema ?? newFormSchema(),
      title: input.name,
    });
    return { formId: input.id ?? uuidv7(), versionId, engineCode, engineSchemaRef };
  }

  /** The form, its first version and every settings group's row, in one transaction. */
  private commitNew(input: CreateInput, prepared: PreparedForm): Promise<CreatedForm> {
    const { formId, versionId, engineCode, engineSchemaRef } = prepared;
    return db.transaction(async (tx) => {
      const form = await createForm(
        {
          id: formId,
          workspaceId: input.workspaceId,
          actorId: input.actorId,
          actorDisplayLabel: input.actorDisplayLabel,
          name: input.name,
          description: input.description,
          formEngineCode: engineCode,
        },
        tx,
      );
      const version = await createFormVersionDraft(
        {
          id: versionId,
          workspaceId: input.workspaceId,
          formId: form.id,
          actorId: input.actorId,
          actorDisplayLabel: input.actorDisplayLabel,
          engineSchemaRef,
        },
        tx,
      );
      await createFormSettings(
        {
          workspaceId: input.workspaceId,
          formId: form.id,
          actorId: input.actorId,
          actorDisplayLabel: input.actorDisplayLabel,
          settings: input.settings,
        },
        tx,
      );
      return { form, version, created: true };
    });
  }

  /**
   * A refused create: the form a request with the same id made, if one committed while this one
   * ran, else a 409 or the error. Every conflict is checked for a replay, since the first attempt's
   * own rows fail the checks (its name, its version id) and Postgres reports only one of the
   * constraints a duplicate breaks.
   */
  private async answerRefusedCreate(err: unknown, input: CreateInput): Promise<CreatedForm> {
    if (input.id && (err instanceof ConflictError || hasPgCode(err, [PG_UNIQUE_VIOLATION]))) {
      const replay = await this.findCreated(input, input.id);
      if (replay) return replay;
    }
    if (isUniqueViolationOn(err, FORM_WORKSPACE_NAME_UNIQUE)) {
      throw new ConflictError(FORM_NAME_TAKEN);
    }
    if (isUniqueViolationOn(err, FORM_PKEY)) {
      throw new ConflictError(FORM_ID_TAKEN);
    }
    if (isUniqueViolationOn(err, FORM_VERSION_PKEY)) {
      throw new ConflictError(FORM_VERSION_ID_TAKEN);
    }
    throw err;
  }

  /** The installed engine the form is created on: the one asked for, else the default. */
  private resolveEngineCode(requested?: string): string {
    const plugins = getFormEnginePlugins();
    if (plugins.length === 0) {
      throw new ValidationError('No form engine plugins installed.');
    }
    const defaultCode =
      env.getFormEngineDefaultCode() ??
      (plugins.some((p) => p.code === 'formio-v5') ? 'formio-v5' : plugins[0].code);
    const engineCode = requested ?? defaultCode;
    if (!plugins.some((p) => p.code === engineCode)) {
      throw new ValidationError(
        requested
          ? `Form engine '${requested}' is not installed`
          : `Default form engine '${defaultCode}' is not installed`,
      );
    }
    resolveFormEnginePlugin(engineCode);
    return engineCode;
  }

  /**
   * The form and first version a create with these ids already made, or null when the form id is
   * unused. A 409 when the form is in another workspace or deleted, or the version is not its own.
   */
  private async findCreated(input: CreateInput, formId: string): Promise<CreatedForm | null> {
    const found = await findFormAnywhere(formId);
    if (!found) return null;
    if (found.workspaceId !== input.workspaceId || found.deletedAt || !input.versionId) {
      throw new ConflictError(FORM_ID_TAKEN);
    }
    const form = await getFormById(input.workspaceId, formId);
    const version = await getFormVersionById(input.workspaceId, input.versionId);
    if (!form || version?.formId !== formId) {
      throw new ConflictError(FORM_ID_TAKEN);
    }
    return { form, version, created: false };
  }

  async update(input: UpdateInput): Promise<FormRecord | null> {
    if (
      input.name !== undefined &&
      (await formNameExistsInWorkspace(input.workspaceId, input.name, input.formId))
    ) {
      throw new ConflictError(FORM_NAME_TAKEN);
    }
    return updateForm(input);
  }

  /**
   * Normalize a schema (import file or export) into a clean, portable, builder-ready form
   * definition using the default form engine. Returns it unchanged if the engine can't normalize.
   */
  normalizeSchema(schema: Record<string, unknown>): Record<string, unknown> {
    const plugins = getFormEnginePlugins();
    if (plugins.length === 0) {
      throw new ValidationError('No form engine plugins installed.');
    }
    const defaultCode =
      env.getFormEngineDefaultCode() ??
      (plugins.some((p) => p.code === 'formio-v5') ? 'formio-v5' : plugins[0].code);
    const adapter = createFormEngineAdapter(defaultCode);
    if (typeof adapter.normalizeSchema !== 'function') {
      return schema;
    }
    return adapter.normalizeSchema(schema);
  }

  async get(workspaceId: string, formId: string): Promise<FormRecord | null> {
    return getFormById(workspaceId, formId);
  }

  async getByEngineSchemaRef(
    workspaceId: string,
    engineSchemaRef: string,
  ): Promise<FormRecord | null> {
    return getFormByEngineSchemaRef(workspaceId, engineSchemaRef);
  }

  async list(input: ListInput) {
    return listFormsForWorkspace(input);
  }

  /** The forms the user holds the submitter role on or has submitted to, in every workspace. */
  async listForSubmitter(input: ListSubmitterFormsInput) {
    return listFormsForSubmitter(input);
  }

  async delete(input: DeleteInput) {
    return markFormDeleted(input.workspaceId, input.formId, input.actorDisplayLabel);
  }
}
