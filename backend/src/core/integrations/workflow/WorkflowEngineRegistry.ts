import { createPluginConfigReader } from '../../config/pluginConfig';
import { env } from '../../config/env';
import type { WorkflowEngineAdapter, WorkflowEngineReadinessResult } from './WorkflowEngineAdapter';
import type { WorkflowEnginePluginDefinition } from './WorkflowEnginePluginDefinition';
import {
  getWorkflowEnginePluginCatalog,
  getWorkflowEnginePluginDefinitions,
} from '../plugins/PluginRegistry';
import type { WorkflowEnginePluginCatalogEntry } from '../plugins/PluginRegistry';

let cachedDefinitions: Map<string, WorkflowEnginePluginDefinition> | null = null;

const getDefinitionsMap = (): Map<string, WorkflowEnginePluginDefinition> => {
  if (!cachedDefinitions) {
    const definitions = getWorkflowEnginePluginDefinitions();
    cachedDefinitions = new Map(definitions.map((definition) => [definition.code, definition]));
  }
  return cachedDefinitions;
};

export const getWorkflowEnginePlugins = (): WorkflowEnginePluginCatalogEntry[] =>
  getWorkflowEnginePluginCatalog();

export const resolveWorkflowEnginePlugin = (code: string): WorkflowEnginePluginDefinition => {
  const definition = getDefinitionsMap().get(code);
  if (!definition) {
    throw new Error(`No workflow engine plugin is installed for code '${code}'`);
  }
  return definition;
};

export const createWorkflowEngineAdapter = (code: string): WorkflowEngineAdapter => {
  const definition = resolveWorkflowEnginePlugin(code);
  return definition.createAdapter(createPluginConfigReader(code));
};

// Safe default: the noop engine is always installed and needs no external service.
const DEFAULT_WORKFLOW_ENGINE_CODE = 'workflow-noop';

/** Engine code the consumer defaults to: WORKFLOW_ENGINE_DEFAULT_CODE, else workflow-noop. */
export const resolveDefaultWorkflowEngineCode = (): string =>
  env.getWorkflowEngineDefaultCode() ?? DEFAULT_WORKFLOW_ENGINE_CODE;

/** Adapter for the default engine (see resolveDefaultWorkflowEngineCode). */
export const createDefaultWorkflowEngineAdapter = (): WorkflowEngineAdapter =>
  createWorkflowEngineAdapter(resolveDefaultWorkflowEngineCode());

/**
 * Run readiness on each registered workflow engine. Only reachability (ok/message) is returned; no
 * config. An engine without a readinessCheck is reported ok.
 */
export const checkWorkflowEngineReadiness = async (): Promise<
  Record<string, WorkflowEngineReadinessResult>
> => {
  const catalog = getWorkflowEnginePluginCatalog();
  const checks = catalog.map(async (entry): Promise<[string, WorkflowEngineReadinessResult]> => {
    try {
      const adapter = createWorkflowEngineAdapter(entry.code);
      const result =
        typeof adapter.readinessCheck === 'function'
          ? await adapter.readinessCheck()
          : { ok: true };
      return [entry.code, result];
    } catch (err) {
      return [
        entry.code,
        {
          ok: false,
          message: err instanceof Error ? err.message : String(err),
        },
      ];
    }
  });

  const entries = await Promise.all(checks);
  return Object.fromEntries(entries);
};
