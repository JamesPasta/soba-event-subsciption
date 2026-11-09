import fs from 'node:fs';
import path from 'node:path';
import { FormEnginePluginDefinition } from './FormEnginePluginDefinition';

interface DiscoveredPluginModule {
  formEnginePluginDefinition?: FormEnginePluginDefinition;
}

const getPluginsRoot = () => path.resolve(__dirname, '../../../plugins');

const discoverPluginModules = (): Array<{ dir: string; module: DiscoveredPluginModule }> => {
  const pluginsRoot = getPluginsRoot();
  if (!fs.existsSync(pluginsRoot)) {
    return [];
  }

  const pluginDirs = fs
    .readdirSync(pluginsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  return pluginDirs.map((pluginDir) => {
    const modulePath = path.join(pluginsRoot, pluginDir);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pluginModule = require(modulePath) as DiscoveredPluginModule;
    return { dir: pluginDir, module: pluginModule };
  });
};

export interface FormEnginePluginCatalogEntry {
  code: string;
  name: string;
  version?: string;
}

export const getFormEnginePluginCatalog = (): FormEnginePluginCatalogEntry[] => {
  const modules = discoverPluginModules();
  return modules
    .map(({ module }) => module.formEnginePluginDefinition ?? null)
    .filter(Boolean)
    .map((definition) => ({
      code: definition!.code,
      name: definition!.metadata.name,
      version: definition!.metadata.version,
    }));
};

export const getFormEnginePluginDefinitions = (): FormEnginePluginDefinition[] => {
  const modules = discoverPluginModules();
  return modules.map(({ module }) => module.formEnginePluginDefinition).filter(Boolean);
};
