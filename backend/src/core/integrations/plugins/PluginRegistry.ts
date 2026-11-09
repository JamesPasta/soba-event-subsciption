/**
 * Plugin discovery + selection. Scans the plugins dir once (lazy, cached), validates each module's
 * exported definitions with Zod, and exposes per-kind definition lists, the discovered catalog, and
 * lazily-instantiated singleton adapters for the selectable kinds (cache, messagebus, temp storage,
 * virus scan).
 * Storage is discovered here too but selected per profile (see getStorageAdapter).
 */
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { PostSubmissionActionScopeSchema } from '@soba/lib';
import { env } from '../../config/env';
import { log } from '../../logging';
import {
  createPluginConfigReader,
  createStorageProfileConfigReader,
  type PluginConfigReader,
} from '../../config/pluginConfig';
import { getStorageProfilesConfig } from '../../config/storageProfiles';
import type { FormEnginePluginDefinition } from '../form-engine/FormEnginePluginDefinition';
import type { DocumentGenerationPluginDefinition } from '../document-generation/DocumentGenerationPluginDefinition';
import type { FeatureApiDefinition } from './FeatureApiDefinition';
import type { CacheAdapter, CachePluginDefinition } from '../cache/CacheAdapter';
import type {
  MessageBusAdapter,
  MessageBusPluginDefinition,
} from '../messagebus/MessageBusAdapter';
import type {
  EventStreamAdapter,
  EventStreamPluginDefinition,
} from '../eventstream/EventStreamAdapter';
import type {
  TempStorageAdapter,
  TempStoragePluginDefinition,
} from '../temp-storage/TempStorageAdapter';
import type { VirusScanAdapter, VirusScanPluginDefinition } from '../virus-scan/VirusScanAdapter';
import type { IdpPluginDefinition } from '../../auth/IdpPlugin';
import type {
  StorageEngineAdapter,
  StorageEngineReadinessResult,
  StoragePluginDefinition,
} from '../storage-engine/StorageEngineAdapter';
import type { CredentialIssuerPluginDefinition } from '../credential-issuer/CredentialIssuerPluginDefinition';
import type { TenantEnginePluginDefinition } from '../tenant/TenantEnginePluginDefinition';
import type { WorkflowEnginePluginDefinition } from '../workflow/WorkflowEnginePluginDefinition';
import type {
  NotificationAdapter,
  NotificationPluginDefinition,
  NotificationReadinessResult,
} from '../notification/NotificationAdapter';
import { reportReadinessByKey } from './readiness';
import type { UserSearchPluginDefinition } from '../user-search/UserSearchPluginDefinition';
import type { PostSubmissionActionPluginDefinition } from '../post-submission-action/PostSubmissionActionPluginDefinition';

// --- Definition schemas -----------------------------------------------------

// cache / messagebus / storage all export the same { code, createAdapter } shape.
const AdapterPluginDefinitionSchema = z.object({
  code: z.string().min(1),
  createAdapter: z.any(),
});

// Registry-backed integrations share this { code, metadata, createAdapter } shape.
const MetadataPluginDefinitionSchema = z.object({
  code: z.string().min(1),
  metadata: z.object({
    code: z.string(),
    name: z.string(),
    version: z.string().optional(),
  }),
  createAdapter: z.any(),
});

const FeatureApiDefinitionSchema = z.object({
  code: z.string().min(1),
  basePath: z.string(),
  createRouter: z.any(),
  registerOpenApi: z.any().optional(),
});

const IdpPluginDefinitionSchema = z.object({
  code: z.string().min(1),
  createAuthMiddleware: z.any(),
  createClaimMapper: z.any(),
});

const hasParsers = (value: unknown): boolean =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { parse?: unknown }).parse === 'function' &&
  typeof (value as { safeParse?: unknown }).safeParse === 'function';

// The code is also a job type and a URL segment, so it is lowercase words joined by dashes.
const PostSubmissionActionPluginDefinitionSchema = z.object({
  code: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  metadata: z.object({
    code: z.string(),
    name: z.string(),
    description: z.string().optional(),
    version: z.string().optional(),
  }),
  featureCode: z.string().min(1).optional(),
  scopes: z.array(PostSubmissionActionScopeSchema).min(1),
  optionsSchema: z.custom(hasParsers, 'Expected a schema with parse and safeParse'),
  job: z.object({
    pool: z.enum(['light', 'heavy']),
    maxAttempts: z.number().int().positive().optional(),
    timeoutMs: z.number().int().positive().optional(),
    run: z.custom((value) => typeof value === 'function', 'Expected a function'),
  }),
});

// --- Discovery --------------------------------------------------------------

interface CachedPlugin {
  dir: string;
  formEngineDefinition?: FormEnginePluginDefinition;
  documentGenerationDefinition?: DocumentGenerationPluginDefinition;
  apiDefinition?: FeatureApiDefinition;
  cacheDefinition?: CachePluginDefinition;
  messagebusDefinition?: MessageBusPluginDefinition;
  eventStreamDefinition?: EventStreamPluginDefinition;
  tempStorageDefinition?: TempStoragePluginDefinition;
  virusScanDefinition?: VirusScanPluginDefinition;
  storageDefinition?: StoragePluginDefinition;
  idpDefinition?: IdpPluginDefinition;
  credentialIssuerDefinition?: CredentialIssuerPluginDefinition;
  tenantEngineDefinition?: TenantEnginePluginDefinition;
  workflowEngineDefinition?: WorkflowEnginePluginDefinition;
  notificationDefinition?: NotificationPluginDefinition;
  userSearchDefinition?: UserSearchPluginDefinition;
  postSubmissionActionDefinition?: PostSubmissionActionPluginDefinition;
}

// Each CachedPlugin definition field, the module export it comes from, and the schema that
// validates it. The one place to add a new plugin kind.
const DEFINITION_KINDS: ReadonlyArray<{
  field: keyof CachedPlugin;
  exportKey: string;
  schema: z.ZodTypeAny;
}> = [
  {
    field: 'formEngineDefinition',
    exportKey: 'formEnginePluginDefinition',
    schema: MetadataPluginDefinitionSchema,
  },
  {
    field: 'documentGenerationDefinition',
    exportKey: 'documentGenerationPluginDefinition',
    schema: MetadataPluginDefinitionSchema,
  },
  { field: 'apiDefinition', exportKey: 'pluginApiDefinition', schema: FeatureApiDefinitionSchema },
  {
    field: 'cacheDefinition',
    exportKey: 'cachePluginDefinition',
    schema: AdapterPluginDefinitionSchema,
  },
  {
    field: 'messagebusDefinition',
    exportKey: 'messagebusPluginDefinition',
    schema: AdapterPluginDefinitionSchema,
  },
  {
    field: 'eventStreamDefinition',
    exportKey: 'eventStreamPluginDefinition',
    schema: AdapterPluginDefinitionSchema,
  },
  {
    field: 'tempStorageDefinition',
    exportKey: 'tempStoragePluginDefinition',
    schema: AdapterPluginDefinitionSchema,
  },
  {
    field: 'virusScanDefinition',
    exportKey: 'virusScanPluginDefinition',
    schema: AdapterPluginDefinitionSchema,
  },
  {
    field: 'storageDefinition',
    exportKey: 'storagePluginDefinition',
    schema: AdapterPluginDefinitionSchema,
  },
  { field: 'idpDefinition', exportKey: 'idpPluginDefinition', schema: IdpPluginDefinitionSchema },
  {
    field: 'credentialIssuerDefinition',
    exportKey: 'credentialIssuerPluginDefinition',
    schema: MetadataPluginDefinitionSchema,
  },
  {
    field: 'tenantEngineDefinition',
    exportKey: 'tenantEnginePluginDefinition',
    schema: MetadataPluginDefinitionSchema,
  },
  {
    field: 'workflowEngineDefinition',
    exportKey: 'workflowEnginePluginDefinition',
    schema: MetadataPluginDefinitionSchema,
  },
  {
    field: 'notificationDefinition',
    exportKey: 'notificationPluginDefinition',
    schema: MetadataPluginDefinitionSchema,
  },
  {
    field: 'userSearchDefinition',
    exportKey: 'userSearchPluginDefinition',
    schema: MetadataPluginDefinitionSchema,
  },
  {
    field: 'postSubmissionActionDefinition',
    exportKey: 'postSubmissionActionPluginDefinition',
    schema: PostSubmissionActionPluginDefinitionSchema,
  },
];

let cache: CachedPlugin[] | null = null;

function getPluginsRoot(): string {
  const fromEnv = env.getPluginsPath();
  if (fromEnv) return path.resolve(fromEnv);
  // Compiled: this file is dist/src/core/integrations/plugins → ../../../plugins = dist/src/plugins.
  // Do not use process.cwd() for dist (breaks when node is started from repo root or /app).
  const runningFromDist = __dirname.includes(path.sep + 'dist' + path.sep);
  if (runningFromDist) {
    return path.resolve(__dirname, '..', '..', '..', 'plugins');
  }
  return path.resolve(process.cwd(), 'src', 'plugins');
}

/**
 * Validate `obj[key]` with `schema`, returning it when valid or undefined (warning when invalid) so
 * a malformed plugin export is skipped rather than fatal.
 */
function parseDefinition(
  obj: Record<string, unknown>,
  pluginDir: string,
  key: string,
  schema: z.ZodTypeAny,
): unknown {
  const value = obj[key];
  if (value === undefined) return undefined;
  const parsed = schema.safeParse(value);
  if (parsed.success) return value;
  log.warn(
    { plugin: pluginDir, key, error: parsed.error.message },
    '[PluginRegistry] invalid plugin definition, skipping',
  );
  return undefined;
}

/** Load and validate a single plugin module into a CachedPlugin entry. Null when the module fails to
 *  load (logged); individual malformed definitions are skipped by parseDefinition. */
function loadPlugin(pluginsRoot: string, pluginDir: string): CachedPlugin | null {
  const modulePath = path.join(pluginsRoot, pluginDir);
  let raw: unknown;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    raw = require(modulePath);
  } catch (err) {
    log.warn({ err, plugin: pluginDir }, '[PluginRegistry] failed to load plugin');
    return null;
  }

  const obj = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const entry: CachedPlugin = { dir: pluginDir };
  // Dynamic-key write; each value's shape is guarded at runtime by its schema.
  const writable = entry as unknown as Record<string, unknown>;
  for (const { field, exportKey, schema } of DEFINITION_KINDS) {
    writable[field] = parseDefinition(obj, pluginDir, exportKey, schema);
  }
  return entry;
}

// Directories under plugins/ that hold shared code, not plugins — skipped by discovery. Put code
// shared between plugins here (e.g. plugins/shared/cdogs/renderBody.ts) instead of a plugin dir.
const NON_PLUGIN_DIRS = new Set(['shared']);

function discoverAndCache(): CachedPlugin[] {
  if (cache) return cache;

  const pluginsRoot = getPluginsRoot();
  if (!fs.existsSync(pluginsRoot)) {
    cache = [];
    return cache;
  }

  const pluginDirs = fs
    .readdirSync(pluginsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !NON_PLUGIN_DIRS.has(entry.name))
    .map((entry) => entry.name);

  const result: CachedPlugin[] = [];
  for (const pluginDir of pluginDirs) {
    const entry = loadPlugin(pluginsRoot, pluginDir);
    if (entry) result.push(entry);
  }

  cache = result;
  return cache;
}

/** All present values of one definition field across discovered plugins. */
function definitionsOf<K extends keyof CachedPlugin>(field: K): NonNullable<CachedPlugin[K]>[] {
  return discoverAndCache()
    .map((p) => p[field])
    .filter((v): v is NonNullable<CachedPlugin[K]> => v !== undefined);
}

/** A plugin (any kind) that opts into feature gating by declaring a `featureCode` on its definition. */
export interface FeatureGatedPlugin {
  code: string;
  featureCode: string;
}

/**
 * Every installed plugin definition — across all kinds — that opts into feature gating by declaring
 * a `featureCode`. Lets callers report or gate such plugins uniformly (e.g. /meta/plugins enablement)
 * without a per-kind method: a new feature-gated plugin family just declares featureCode.
 */
export function getFeatureGatedPluginCodes(): FeatureGatedPlugin[] {
  const gated: FeatureGatedPlugin[] = [];
  for (const { field } of DEFINITION_KINDS) {
    // An action plugin is on where POST_SUBMISSION_ACTION_PLUGINS lists it; its feature only narrows
    // which forms it runs for.
    if (field === 'postSubmissionActionDefinition') continue;
    for (const def of definitionsOf(field)) {
      const d = def as { code?: unknown; featureCode?: unknown };
      if (typeof d.code === 'string' && typeof d.featureCode === 'string' && d.featureCode) {
        gated.push({ code: d.code, featureCode: d.featureCode });
      }
    }
  }
  return gated;
}

// --- Catalog + definition getters -------------------------------------------

export interface PluginCatalogEntry {
  code: string;
  hasApi: boolean;
  apiBasePath?: string;
}

export function getPluginCatalog(): PluginCatalogEntry[] {
  const discovered = discoverAndCache();
  return discovered.map((p) => {
    const code =
      p.apiDefinition?.code ??
      p.formEngineDefinition?.code ??
      p.documentGenerationDefinition?.code ??
      p.cacheDefinition?.code ??
      p.messagebusDefinition?.code ??
      p.eventStreamDefinition?.code ??
      p.tempStorageDefinition?.code ??
      p.virusScanDefinition?.code ??
      p.storageDefinition?.code ??
      p.idpDefinition?.code ??
      p.credentialIssuerDefinition?.code ??
      p.tenantEngineDefinition?.code ??
      p.workflowEngineDefinition?.code ??
      p.notificationDefinition?.code ??
      p.userSearchDefinition?.code ??
      p.postSubmissionActionDefinition?.code ??
      p.dir;
    return {
      code,
      hasApi: Boolean(p.apiDefinition),
      apiBasePath: p.apiDefinition?.basePath,
    };
  });
}

export function getEnabledPluginApiDefinitions(): FeatureApiDefinition[] {
  return definitionsOf('apiDefinition');
}

export interface FormEnginePluginCatalogEntry {
  code: string;
  name: string;
  version?: string;
}

export function getFormEnginePluginCatalog(): FormEnginePluginCatalogEntry[] {
  return getFormEnginePluginDefinitions().map((d) => ({
    code: d.code,
    name: d.metadata.name,
    version: d.metadata.version,
  }));
}

export function getFormEnginePluginDefinitions(): FormEnginePluginDefinition[] {
  return definitionsOf('formEngineDefinition');
}

export interface DocumentGenerationPluginCatalogEntry {
  code: string;
  name: string;
  version?: string;
}

export function getDocumentGenerationPluginCatalog(): DocumentGenerationPluginCatalogEntry[] {
  return getDocumentGenerationPluginDefinitions().map((d) => ({
    code: d.code,
    name: d.metadata.name,
    version: d.metadata.version,
  }));
}

export function getDocumentGenerationPluginDefinitions(): DocumentGenerationPluginDefinition[] {
  return definitionsOf('documentGenerationDefinition');
}

export interface TenantEnginePluginCatalogEntry {
  code: string;
  name: string;
  version?: string;
}

export function getTenantEnginePluginCatalog(): TenantEnginePluginCatalogEntry[] {
  return getTenantEnginePluginDefinitions().map((d) => ({
    code: d.code,
    name: d.metadata.name,
    version: d.metadata.version,
  }));
}

export function getTenantEnginePluginDefinitions(): TenantEnginePluginDefinition[] {
  return definitionsOf('tenantEngineDefinition');
}

export interface WorkflowEnginePluginCatalogEntry {
  code: string;
  name: string;
  version?: string;
}

export function getWorkflowEnginePluginCatalog(): WorkflowEnginePluginCatalogEntry[] {
  return getWorkflowEnginePluginDefinitions().map((d) => ({
    code: d.code,
    name: d.metadata.name,
    version: d.metadata.version,
  }));
}

export function getWorkflowEnginePluginDefinitions(): WorkflowEnginePluginDefinition[] {
  return definitionsOf('workflowEngineDefinition');
}

export interface UserSearchPluginCatalogEntry {
  code: string;
  name: string;
  version?: string;
}

export function getUserSearchPluginCatalog(): UserSearchPluginCatalogEntry[] {
  return getUserSearchPluginDefinitions().map((d) => ({
    code: d.code,
    name: d.metadata.name,
    version: d.metadata.version,
  }));
}

export function getUserSearchPluginDefinitions(): UserSearchPluginDefinition[] {
  return definitionsOf('userSearchDefinition');
}

export function getCachePluginDefinitions(): CachePluginDefinition[] {
  return definitionsOf('cacheDefinition');
}

export function getMessageBusPluginDefinitions(): MessageBusPluginDefinition[] {
  return definitionsOf('messagebusDefinition');
}

export function getEventStreamPluginDefinitions(): EventStreamPluginDefinition[] {
  return definitionsOf('eventStreamDefinition');
}

export function getTempStoragePluginDefinitions(): TempStoragePluginDefinition[] {
  return definitionsOf('tempStorageDefinition');
}

export function getVirusScanPluginDefinitions(): VirusScanPluginDefinition[] {
  return definitionsOf('virusScanDefinition');
}

export function getStoragePluginDefinitions(): StoragePluginDefinition[] {
  return definitionsOf('storageDefinition');
}

export function getIdpPluginDefinitions(): IdpPluginDefinition[] {
  return definitionsOf('idpDefinition');
}

export function getNotificationPluginDefinitions(): NotificationPluginDefinition[] {
  return definitionsOf('notificationDefinition');
}

export interface CredentialIssuerPluginCatalogEntry {
  code: string;
  name: string;
  version?: string;
}

export function getCredentialIssuerPluginDefinitions(): CredentialIssuerPluginDefinition[] {
  return definitionsOf('credentialIssuerDefinition');
}

export function getCredentialIssuerPluginCatalog(): CredentialIssuerPluginCatalogEntry[] {
  return getCredentialIssuerPluginDefinitions().map((definition) => ({
    ...definition.metadata,
    code: definition.code,
  }));
}

let postSubmissionActions: PostSubmissionActionPluginDefinition[] | null = null;

/** One definition per code, since each code is a job type: a later folder with a taken code is skipped. */
function uniquePostSubmissionActions(): PostSubmissionActionPluginDefinition[] {
  const byCode = new Map<string, PostSubmissionActionPluginDefinition>();
  for (const plugin of discoverAndCache()) {
    const definition = plugin.postSubmissionActionDefinition;
    if (definition && byCode.has(definition.code)) {
      log.warn(
        { plugin: plugin.dir, code: definition.code },
        '[PluginRegistry] duplicate post-submission action code, skipping',
      );
    } else if (definition) {
      byCode.set(definition.code, definition);
    }
  }
  return [...byCode.values()];
}

export function getPostSubmissionActionPluginDefinitions(): PostSubmissionActionPluginDefinition[] {
  postSubmissionActions ??= uniquePostSubmissionActions();
  return postSubmissionActions;
}

// --- Selectable adapters (singleton by code) --------------------------------

// Active plugin code per selectable kind. Adapter getters, dedicated registries and /meta/plugins resolve
// through this, so they can't drift. Storage is not here — it is selected per profile.
const SELECTABLE_PLUGIN_DEFAULTS = {
  credentialIssuer: {
    label: 'credential-issuer',
    configured: () => env.getCredentialIssuerDefaultCode(),
    fallback: 'credential-issuer-noop',
  },
  cache: { label: 'cache', configured: () => env.getCacheDefaultCode(), fallback: 'cache-memory' },
  messagebus: {
    label: 'messagebus',
    configured: () => env.getMessageBusDefaultCode(),
    fallback: 'messagebus-memory',
  },
  eventStream: {
    label: 'eventstream',
    configured: () => env.getEventStreamDefaultCode(),
    fallback: 'eventstream-memory',
  },
  tempStorage: {
    label: 'temp-storage',
    configured: () => env.getTempStorageDefaultCode(),
    fallback: 'tempstorage-os',
  },
  virusScan: {
    label: 'virus-scan',
    configured: () => env.getVirusScanDefaultCode(),
    fallback: 'virusscan-noop',
  },
  notification: {
    label: 'notification',
    configured: () => env.getNotificationDefaultCode(),
    fallback: 'notification-noop',
  },
} as const;

type SelectablePluginType = keyof typeof SELECTABLE_PLUGIN_DEFAULTS;

/** The code the registry will instantiate for a selectable plugin kind. */
export function resolveActivePluginCode(type: SelectablePluginType): string {
  const { configured, fallback } = SELECTABLE_PLUGIN_DEFAULTS[type];
  return configured() ?? fallback;
}

/** Codes of the plugins actually selected across every selectable kind. */
export function getActivePluginCodes(): Set<string> {
  const types = Object.keys(SELECTABLE_PLUGIN_DEFAULTS) as SelectablePluginType[];
  return new Set(types.map(resolveActivePluginCode));
}

/**
 * Storage backend codes referenced by the active storage profiles. Storage is profile-keyed rather
 * than singleton-by-code, so it isn't part of getActivePluginCodes — callers that report the active
 * set (e.g. /meta/plugins) union this in.
 */
export function getActiveStorageBackendCodes(): Set<string> {
  return new Set(Object.values(getStorageProfilesConfig()).map((profile) => profile.backend));
}

/** Minimal shape shared by every adapter plugin definition. */
interface AdapterDefinition<T> {
  code: string;
  createAdapter: (config: PluginConfigReader) => T;
}

/** Memoized getter for a selectable adapter: resolve the active code, find its definition,
 *  construct once. Throws (listing installed codes) if none matches. */
function lazyAdapter<T>(
  type: SelectablePluginType,
  getDefinitions: () => AdapterDefinition<T>[],
): () => T {
  let instance: T | undefined;
  return () => {
    if (instance === undefined) {
      const code = resolveActivePluginCode(type);
      const definitions = getDefinitions();
      const definition = definitions.find((d) => d.code === code);
      if (!definition) {
        const available = definitions.map((d) => d.code).join(', ') || '<none>';
        throw new Error(
          `No ${SELECTABLE_PLUGIN_DEFAULTS[type].label} plugin is installed for code '${code}'. Available: ${available}`,
        );
      }
      instance = definition.createAdapter(createPluginConfigReader(definition.code));
    }
    return instance;
  };
}

export const getCacheAdapter = lazyAdapter<CacheAdapter>('cache', getCachePluginDefinitions);
export const getMessageBusAdapter = lazyAdapter<MessageBusAdapter>(
  'messagebus',
  getMessageBusPluginDefinitions,
);
export const getEventStreamAdapter = lazyAdapter<EventStreamAdapter>(
  'eventStream',
  getEventStreamPluginDefinitions,
);
export const getTempStorageAdapter = lazyAdapter<TempStorageAdapter>(
  'tempStorage',
  getTempStoragePluginDefinitions,
);
export const getVirusScanAdapter = lazyAdapter<VirusScanAdapter>(
  'virusScan',
  getVirusScanPluginDefinitions,
);
export const getNotificationAdapter = lazyAdapter<NotificationAdapter>(
  'notification',
  getNotificationPluginDefinitions,
);

/**
 * Readiness of the active notification plugin, keyed by its code. Never throws: a plugin that cannot
 * be created (missing config) yields { ok: false, message }; one with no readinessCheck is ok.
 */
export function checkNotificationReadiness(): Promise<Record<string, NotificationReadinessResult>> {
  return reportReadinessByKey([resolveActivePluginCode('notification')], () =>
    getNotificationAdapter().readinessCheck?.(),
  );
}

// --- Storage (discovered above, but selected per profile) -------------------

const storageAdapterByProfile = new Map<string, StorageEngineAdapter>();

/**
 * Storage adapter for a profile (default 'default'). Profiles let multiple backends run at once
 * (e.g. separate S3 buckets); each is configured under STORAGE_PROFILE_<PROFILE>_* and cached.
 */
export function getStorageAdapter(profile: string = 'default'): StorageEngineAdapter {
  const cached = storageAdapterByProfile.get(profile);
  if (cached) return cached;

  const profiles = getStorageProfilesConfig();
  const profileConfig = profiles[profile];
  if (!profileConfig) {
    throw new Error(
      `No storage profile '${profile}' is configured. Available: ${Object.keys(profiles).join(', ') || '<none>'}`,
    );
  }
  const definitions = getStoragePluginDefinitions();
  const definition = definitions.find((d) => d.code === profileConfig.backend);
  if (!definition) {
    throw new Error(
      `Storage profile '${profile}' uses backend '${profileConfig.backend}', which is not installed. Available: ${definitions.map((d) => d.code).join(', ') || '<none>'}`,
    );
  }
  const adapter = definition.createAdapter(createStorageProfileConfigReader(profile));
  storageAdapterByProfile.set(profile, adapter);
  return adapter;
}

/**
 * Readiness of every configured storage profile, keyed by profile name. Never throws — a profile
 * that is unreachable or misconfigured yields { ok: false, message }; one with no readinessCheck
 * yields { ok: true }.
 */
export function checkStorageReadiness(): Promise<Record<string, StorageEngineReadinessResult>> {
  return reportReadinessByKey(Object.keys(getStorageProfilesConfig()), (profile) =>
    getStorageAdapter(profile).readinessCheck?.(),
  );
}
