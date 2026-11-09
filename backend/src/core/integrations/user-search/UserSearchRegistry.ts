import { createPluginConfigReader } from '../../config/pluginConfig';
import { env } from '../../config/env';
import type { UserSearchAdapter, UserSearchReadinessResult } from './UserSearchAdapter';
import type { UserSearchPluginDefinition } from './UserSearchPluginDefinition';
import {
  getUserSearchPluginCatalog,
  getUserSearchPluginDefinitions,
} from '../plugins/PluginRegistry';
import type { UserSearchPluginCatalogEntry } from '../plugins/PluginRegistry';
import { reportReadinessByKey } from '../plugins/readiness';

let cachedDefinitions: Map<string, UserSearchPluginDefinition> | null = null;

const getDefinitionsMap = (): Map<string, UserSearchPluginDefinition> => {
  if (!cachedDefinitions) {
    const definitions = getUserSearchPluginDefinitions();
    cachedDefinitions = new Map(definitions.map((definition) => [definition.code, definition]));
  }
  return cachedDefinitions;
};

export const getUserSearchPlugins = (): UserSearchPluginCatalogEntry[] =>
  getUserSearchPluginCatalog();

export const resolveUserSearchPlugin = (code: string): UserSearchPluginDefinition => {
  const definition = getDefinitionsMap().get(code);
  if (!definition) {
    throw new Error(`No user search plugin is installed for code '${code}'`);
  }
  return definition;
};

export const createUserSearchAdapter = (code: string): UserSearchAdapter => {
  const definition = resolveUserSearchPlugin(code);
  return definition.createAdapter(createPluginConfigReader(code));
};

/** USER_SEARCH_PLUGINS, in order. Earlier plugins win when results are merged. */
export const getEnabledUserSearchPluginCodes = (): string[] => [
  ...new Set(env.getUserSearchPlugins()),
];

/**
 * Run readiness on each enabled plugin. Only reachability (ok/message) is returned; no config.
 * An unknown code or missing config reports not ready.
 */
export const checkUserSearchReadiness = (): Promise<Record<string, UserSearchReadinessResult>> =>
  reportReadinessByKey(getEnabledUserSearchPluginCodes(), (code) =>
    createUserSearchAdapter(code).readinessCheck?.(),
  );
