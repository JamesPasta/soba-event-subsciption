import { createPluginConfigReader } from '../../config/pluginConfig';
import { FormEngineAdapter, type FormEngineReadinessResult } from './FormEngineAdapter';
import { FormEnginePluginDefinition } from './FormEnginePluginDefinition';
import {
  getFormEnginePluginCatalog,
  getFormEnginePluginDefinitions,
} from '../plugins/PluginRegistry';
import type { FormEnginePluginCatalogEntry } from '../plugins/PluginRegistry';
import { reportReadinessByKey } from '../plugins/readiness';

let cachedDefinitions: Map<string, FormEnginePluginDefinition> | null = null;

const getDefinitionsMap = (): Map<string, FormEnginePluginDefinition> => {
  if (!cachedDefinitions) {
    const definitions = getFormEnginePluginDefinitions();
    cachedDefinitions = new Map(definitions.map((definition) => [definition.code, definition]));
  }
  return cachedDefinitions;
};

export const getFormEnginePlugins = (): FormEnginePluginCatalogEntry[] =>
  getFormEnginePluginCatalog();

export const resolveFormEnginePlugin = (engineCode: string): FormEnginePluginDefinition => {
  const definition = getDefinitionsMap().get(engineCode);
  if (!definition) {
    throw new Error(`No form engine plugin is installed for code '${engineCode}'`);
  }
  return definition;
};

export const createFormEngineAdapter = (engineCode: string): FormEngineAdapter => {
  const definition = resolveFormEnginePlugin(engineCode);
  return definition.createAdapter(createPluginConfigReader(engineCode));
};

/**
 * Run readiness check on each registered form engine. Only reachability (ok/message) is returned; no config.
 */
export const checkFormEngineReadiness = (): Promise<Record<string, FormEngineReadinessResult>> =>
  reportReadinessByKey(
    getFormEnginePluginCatalog().map((entry) => entry.code),
    (code) => createFormEngineAdapter(code).readinessCheck?.(),
  );
