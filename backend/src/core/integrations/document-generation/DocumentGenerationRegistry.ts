import { createPluginConfigReader } from '../../config/pluginConfig';
import { env } from '../../config/env';
import {
  DocumentGenerationAdapter,
  type DocumentGenerationReadinessResult,
} from './DocumentGenerationAdapter';
import { DocumentGenerationPluginDefinition } from './DocumentGenerationPluginDefinition';
import {
  getDocumentGenerationPluginCatalog,
  getDocumentGenerationPluginDefinitions,
} from '../plugins/PluginRegistry';
import type { DocumentGenerationPluginCatalogEntry } from '../plugins/PluginRegistry';
import { reportReadinessByKey } from '../plugins/readiness';

let cachedDefinitions: Map<string, DocumentGenerationPluginDefinition> | null = null;

const getDefinitionsMap = (): Map<string, DocumentGenerationPluginDefinition> => {
  if (!cachedDefinitions) {
    const definitions = getDocumentGenerationPluginDefinitions();
    cachedDefinitions = new Map(definitions.map((definition) => [definition.code, definition]));
  }
  return cachedDefinitions;
};

export const getDocumentGenerationPlugins = (): DocumentGenerationPluginCatalogEntry[] =>
  getDocumentGenerationPluginCatalog();

export const resolveDocumentGenerationPlugin = (
  code: string,
): DocumentGenerationPluginDefinition => {
  const definition = getDefinitionsMap().get(code);
  if (!definition) {
    throw new Error(`No document generation plugin is installed for code '${code}'`);
  }
  return definition;
};

export const createDocumentGenerationAdapter = (code: string): DocumentGenerationAdapter => {
  const definition = resolveDocumentGenerationPlugin(code);
  return definition.createAdapter(createPluginConfigReader(code));
};

// Safe default: the noop backend is always installed and needs no external service.
const DEFAULT_DOCUMENT_GENERATION_CODE = 'docgen-noop';

/** Backend code the consumer defaults to: DOCUMENT_GENERATION_DEFAULT_CODE, else docgen-noop. */
export const resolveDefaultDocumentGenerationCode = (): string =>
  env.getDocumentGenerationDefaultCode() ?? DEFAULT_DOCUMENT_GENERATION_CODE;

/** Adapter for the default backend (see resolveDefaultDocumentGenerationCode). */
export const createDefaultDocumentGenerationAdapter = (): DocumentGenerationAdapter =>
  createDocumentGenerationAdapter(resolveDefaultDocumentGenerationCode());

/**
 * Run readiness on each registered document-generation backend. Only reachability (ok/message)
 * is returned; no config. A backend without a readinessCheck is reported ok.
 */
export const checkDocumentGenerationReadiness = (): Promise<
  Record<string, DocumentGenerationReadinessResult>
> =>
  reportReadinessByKey(
    getDocumentGenerationPluginCatalog().map((entry) => entry.code),
    (code) => createDocumentGenerationAdapter(code).readinessCheck?.(),
  );
