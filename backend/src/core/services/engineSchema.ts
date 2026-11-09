import { createFormEngineAdapter } from '../integrations/form-engine/FormEngineRegistry';
import type { UpsertSchemaInput } from '../integrations/form-engine/FormEngineAdapter';
import { ValidationError } from '../errors';
import { log } from '../logging';
import { schemaHashOf } from './schemaHash';

type SchemaWriter = (input: UpsertSchemaInput) => Promise<{ engineRef: string }>;

/** The engine's schema writer; a ValidationError when the engine cannot write schemas. */
export const schemaWriterFor = (engineCode: string): SchemaWriter => {
  const adapter = createFormEngineAdapter(engineCode);
  if (typeof adapter.upsertSchema !== 'function') {
    throw new ValidationError(`Form engine '${engineCode}' does not support schema provisioning`);
  }
  return adapter.upsertSchema.bind(adapter);
};

/**
 * Writes a form version's schema to its form engine document, keyed by the version id, and returns
 * the document's ref. Writing the same version again updates the same document.
 */
export const writeEngineSchema = async (
  input: UpsertSchemaInput & { engineCode: string },
): Promise<string> => {
  const { engineRef } = await schemaWriterFor(input.engineCode)({
    formVersionId: input.formVersionId,
    workspaceId: input.workspaceId,
    schema: input.schema,
    title: input.title,
  });
  return engineRef;
};

/**
 * Deletes the document a create wrote when an overlapping create with the same version id committed
 * another. A document a failed delete leaves is removed if the version is saved again.
 */
export const discardLostEngineSchema = async (
  engineCode: string,
  committed: { id: string; engineSchemaRef: string | null },
  written: string,
): Promise<void> => {
  if (committed.engineSchemaRef === written) return;
  const adapter = createFormEngineAdapter(engineCode);
  if (typeof adapter.deleteSchema !== 'function') return;
  try {
    await adapter.deleteSchema(written);
  } catch (err) {
    log.warn(
      { err, formVersionId: committed.id, engineRef: written },
      'Unused form engine document not deleted',
    );
  }
};

/** Reads a schema from its engine document; null when there is none or the engine cannot read. */
export const readEngineSchema = async (
  engineCode: string,
  engineSchemaRef: string | null,
): Promise<Record<string, unknown> | null> => {
  if (!engineSchemaRef) return null;
  const adapter = createFormEngineAdapter(engineCode);
  if (typeof adapter.readSchema !== 'function') return null;
  return adapter.readSchema(engineSchemaRef);
};

/** The hash of what the engine renders from a schema it stored. */
export const hashEngineSchema = (engineCode: string, schema: Record<string, unknown>): string =>
  schemaHashOf(schema, createFormEngineAdapter(engineCode));
