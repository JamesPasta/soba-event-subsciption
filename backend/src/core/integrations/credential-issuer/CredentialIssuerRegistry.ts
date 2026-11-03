import { createPluginConfigReader } from '../../config/pluginConfig';
import type {
  CredentialIssuerAdapter,
  CredentialIssuerReadinessResult,
} from './CredentialIssuerAdapter';
import type { CredentialIssuerPluginDefinition } from './CredentialIssuerPluginDefinition';
import {
  resolveActivePluginCode,
  getCredentialIssuerPluginCatalog,
  getCredentialIssuerPluginDefinitions,
} from '../plugins/PluginRegistry';
import type { CredentialIssuerPluginCatalogEntry } from '../plugins/PluginRegistry';
import { reportReadinessByKey } from '../plugins/readiness';

let cachedDefinitions: Map<string, CredentialIssuerPluginDefinition> | null = null;

const getDefinitionsMap = (): Map<string, CredentialIssuerPluginDefinition> => {
  if (!cachedDefinitions) {
    const definitions = getCredentialIssuerPluginDefinitions();
    cachedDefinitions = new Map(definitions.map((definition) => [definition.code, definition]));
  }
  return cachedDefinitions;
};

export const getCredentialIssuerPlugins = (): CredentialIssuerPluginCatalogEntry[] =>
  getCredentialIssuerPluginCatalog();

export const resolveCredentialIssuerPlugin = (code: string): CredentialIssuerPluginDefinition => {
  const definition = getDefinitionsMap().get(code);
  if (!definition) {
    throw new Error(`No credential issuer plugin is installed for code '${code}'`);
  }
  return definition;
};

export const createCredentialIssuerAdapter = (code: string): CredentialIssuerAdapter => {
  const definition = resolveCredentialIssuerPlugin(code);
  return definition.createAdapter(createPluginConfigReader(code));
};

/** Issuer code the consumer defaults to: CREDENTIAL_ISSUER_DEFAULT_CODE, else credential-issuer-noop. */
export const resolveDefaultCredentialIssuerCode = (): string =>
  resolveActivePluginCode('credentialIssuer');

/** Adapter for the default issuer (see resolveDefaultCredentialIssuerCode). */
export const createDefaultCredentialIssuerAdapter = (): CredentialIssuerAdapter =>
  createCredentialIssuerAdapter(resolveDefaultCredentialIssuerCode());

/**
 * Run readiness on each registered credential issuer. Only readiness (ok/message) is returned; no
 * config. An issuer without a readinessCheck is reported ok.
 */
export const checkCredentialIssuerReadiness = (): Promise<
  Record<string, CredentialIssuerReadinessResult>
> =>
  reportReadinessByKey(
    getCredentialIssuerPluginCatalog().map((entry) => entry.code),
    (code) => createCredentialIssuerAdapter(code).readinessCheck?.(),
  );
