import { createPluginConfigReader } from '../../config/pluginConfig';
import { env } from '../../config/env';
import type { TenantEngineAdapter, TenantEngineReadinessResult } from './TenantEngineAdapter';
import type { TenantEnginePluginDefinition } from './TenantEnginePluginDefinition';
import {
  getTenantEnginePluginCatalog,
  getTenantEnginePluginDefinitions,
} from '../plugins/PluginRegistry';
import type { TenantEnginePluginCatalogEntry } from '../plugins/PluginRegistry';
import { reportReadinessByKey } from '../plugins/readiness';

let cachedDefinitions: Map<string, TenantEnginePluginDefinition> | null = null;

const getDefinitionsMap = (): Map<string, TenantEnginePluginDefinition> => {
  if (!cachedDefinitions) {
    const definitions = getTenantEnginePluginDefinitions();
    cachedDefinitions = new Map(definitions.map((definition) => [definition.code, definition]));
  }
  return cachedDefinitions;
};

export const getTenantEnginePlugins = (): TenantEnginePluginCatalogEntry[] =>
  getTenantEnginePluginCatalog();

export const resolveTenantEnginePlugin = (code: string): TenantEnginePluginDefinition => {
  const definition = getDefinitionsMap().get(code);
  if (!definition) {
    throw new Error(`No tenant engine plugin is installed for code '${code}'`);
  }
  return definition;
};

export const createTenantEngineAdapter = (code: string): TenantEngineAdapter => {
  const definition = resolveTenantEnginePlugin(code);
  return definition.createAdapter(createPluginConfigReader(code));
};

// Safe default: the noop engine is always installed and needs no external service.
const DEFAULT_TENANT_ENGINE_CODE = 'tenant-noop';

/** Engine code the consumer defaults to: TENANT_ENGINE_DEFAULT_CODE, else tenant-noop. */
export const resolveDefaultTenantEngineCode = (): string =>
  env.getTenantEngineDefaultCode() ?? DEFAULT_TENANT_ENGINE_CODE;

/** Adapter for the default engine (see resolveDefaultTenantEngineCode). */
export const createDefaultTenantEngineAdapter = (): TenantEngineAdapter =>
  createTenantEngineAdapter(resolveDefaultTenantEngineCode());

/**
 * Run readiness on each registered tenant engine. Only reachability (ok/message) is returned; no
 * config. An engine without a readinessCheck is reported ok.
 */
export const checkTenantEngineReadiness = (): Promise<
  Record<string, TenantEngineReadinessResult>
> =>
  reportReadinessByKey(
    getTenantEnginePluginCatalog().map((entry) => entry.code),
    (code) => createTenantEngineAdapter(code).readinessCheck?.(),
  );
