# How to add a plugin

Plugins live in `backend/src/plugins/<directory>`. `PluginRegistry` loads each directory and keeps the exports named in `DEFINITION_KINDS`. What the kinds do today is in [Plugin implementations](../DEVELOPER.md#plugin-implementations).

Copy document generation (`docgen-noop`, `cdogs-v2`, `cdogs-v3`, `DocumentGenerationRegistry`) or the tenant engine (`tenant-noop`, `cstar-v1`, `TenantEngineRegistry`). Both are a default code, a noop, and an adapter the consumer calls. Cache, storage, and IdP use other definition shapes. Copy the file named in the table.

A plugin for a kind that already exists skips sections 2 and 3.

| Model                   | Kinds                                                      | Chosen by                                                                                                                                                                                         | Copy                                                       |
| ----------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| One active plugin       | cache, message bus, event stream, temp storage, virus scan | `CACHE_DEFAULT_CODE`, `MESSAGEBUS_DEFAULT_CODE`, `EVENTSTREAM_DEFAULT_CODE`, `TEMPSTORAGE_DEFAULT_CODE`, `VIRUSSCAN_DEFAULT_CODE`. Unset falls back to the code in `SELECTABLE_PLUGIN_DEFAULTS`.  | `lazyAdapter` in `PluginRegistry.ts`                       |
| Default code            | document generation, tenant engine                         | `DOCUMENT_GENERATION_DEFAULT_CODE` or `docgen-noop`. `TENANT_ENGINE_DEFAULT_CODE` or `tenant-noop`. The route does not take an engine code.                                                       | `DocumentGenerationRegistry.ts`, `TenantEngineRegistry.ts` |
| Per form                | form engine                                                | `FORM_ENGINE_DEFAULT_CODE`, else the first discovered plugin, else `formio-v5`. Each form stores `form_engine_code`. No noop. Every form engine's readiness sets the `/health/ready` status code. | `FormEngineRegistry.ts`                                    |
| One backend per profile | storage                                                    | `STORAGE_PROFILES` and `STORAGE_PROFILE_<PROFILE>_BACKEND`                                                                                                                                        | `getStorageAdapter` in `PluginRegistry.ts`                 |
| Ordered list            | IdP                                                        | `IDP_PLUGINS`. The first plugin that accepts the token wins.                                                                                                                                      | `core/auth/idpRegistry.ts`                                 |
| Ordered list, merged    | user search                                                | `USER_SEARCH_PLUGINS`. Every listed plugin that accepts the filters is asked; earlier plugins win per field when results merge. Unset enables none.                                               | `UserSearchRegistry.ts`                                    |

A document-generation definition may set `featureCode`. `resolveBackendCode` in `features/document-generation/service.ts` uses a granted scoped backend instead of the default, then the default if its own feature (when it has one) is available. Other kinds are chosen by config only.

`pluginApiDefinition` is validated. Nothing imports `pluginApis.ts`, so `createPluginApiRouter` is never mounted. Put routes in a core or feature module that calls the adapter. `GET /me/tenants` is the tenant example.

## 1. Naming

- Directory name and `code` are the same string. `idp-bcgov-sso` is the exception: its code is `bcgov-sso`, so its env prefix is `PLUGIN_BCGOV_SSO_*`. Leave that one as it is.
- Registry plugins (`MetadataPluginDefinitionSchema`) also set `metadata.code` to that string. Cache, storage, and the other `AdapterPluginDefinitionSchema` plugins have no metadata.
- An external service is `<product>-v<N>` (`formio-v5`, `cdogs-v3`, `cstar-v1`). A plugin that calls nothing is `<kind>-noop` (`docgen-noop`, `tenant-noop`, `virusscan-noop`). In-process stand-ins are named for what they are (`cache-memory`, `tempstorage-os`).
- The export name is the `exportKey` in `DEFINITION_KINDS` (`documentGenerationPluginDefinition`, `tenantEnginePluginDefinition`, and so on). A module that exports something else still appears in `/meta/plugins`, under the directory name, and nothing selects it.
- Config keys are `PLUGIN_<CODE>_<KEY>`. The code is uppercased and each run of other characters becomes `_`, so `cstar-v1` reads `PLUGIN_CSTAR_V1_API_BASE_URL`. Renaming the code changes that prefix. Update the Helm template that writes the keys.
- Code shared by plugins goes in `backend/src/plugins/shared/`. Discovery skips that directory.

## 2. A new kind: contracts and registry

Under `backend/src/core/integrations/<kind>/`, same layout as `document-generation/` and `tenant/`:

- `<Kind>Adapter.ts`. The adapter interface. `readinessCheck(): Promise<{ ok: boolean; message?: string }>` is optional. A failed call to the remote service throws an `AppError` from `core/errors.ts`. An empty result (`[]` from `tenant-noop`, the placeholder bytes from `docgen-noop`) is a normal return.
- `<Kind>PluginDefinition.ts`: `{ code, metadata, createAdapter(config) }`. Document generation adds an optional `featureCode`. A `featureCode` needs its `soba.feature` row, added by a migration as in `drizzle/0021_add_document_generation_features.sql`, and a constant in `Features` (`core/db/codes/index.ts`).
- `<Kind>Registry.ts`: look up a definition by code, `resolveDefault<Kind>Code()` (the env value, or the noop code as a named constant), `createDefault<Kind>Adapter()`, and `check<Kind>Readiness()`. The readiness function catches errors and returns `{ ok: false, message }`.

In `core/integrations/plugins/PluginRegistry.ts`:

- A `DEFINITION_KINDS` entry: field, export key, schema. A registry kind uses `MetadataPluginDefinitionSchema`. A selectable kind uses `AdapterPluginDefinitionSchema`. IdP and `pluginApi` already have their own schemas.
- The field on `CachedPlugin`, and that field in the `getPluginCatalog` code chain.
- `get<Kind>PluginCatalog()` and `get<Kind>PluginDefinitions()` next to the other getters.

A selectable kind has no registry file. Add a row to `SELECTABLE_PLUGIN_DEFAULTS` and a `lazyAdapter` getter. Those env vars have no underscore between words (`MESSAGEBUS_DEFAULT_CODE`). A new registry kind follows `TENANT_ENGINE_DEFAULT_CODE` and `DOCUMENT_GENERATION_DEFAULT_CODE`.

Add `get<Kind>DefaultCode()` to both `createEnvReader` and `env` in `core/config/env.ts`, and a case in `tests/core/config/env.test.ts`.

## 3. A new kind: noop, meta and health

- A `<kind>-noop` plugin with no config and no outbound call, as `docgen-noop` and `tenant-noop`. It is the default, so a deployment without the real service still starts.
- `/meta/plugins` already includes selectable plugins and storage backends, through `getActivePluginCodes` and `getActiveStorageBackendCodes`. A registry kind is not in that set. Add its default code to the active set in `core/api/meta/service.ts`, as the form engine (inline) and the tenant engine (`resolveDefaultTenantEngineCode()`) are. A definition with `featureCode` is picked up by `getFeatureGatedPluginCodes` when that feature is platform-enabled. `docgen-noop` has neither, so `/meta/plugins` reports it disabled while it is the default. Don't repeat that.
- `/health/ready`: call `check<Kind>Readiness()` from `core/api/health/readyHandler.ts` and add the field to `HealthReadinessResponseSchema` and the 200 description in `core/api/health/schema.ts`. Only the database and the form engines change the status code. Document generation and the tenant engine are reported and left non-gating. The chart's liveness and readiness probes call `/api/v1/health`, which runs none of these checks. `/health/ready` and the startup log wait for every check, up to its timeout.
- Startup: `log<Kind>Readiness()` in `core/api/health/startupHealth.ts`, exported from `core/api/health/index.ts`, and chained in `app.ts`.

## 4. The plugin

`backend/src/plugins/<code>/index.ts` exports the definition. The adapter class sits in the same directory.

- Read config only through the `PluginConfigReader` passed to `createAdapter`. `getRequired` for a key the plugin cannot run without. A missing key throws from the constructor, and readiness reports that error, which names the env var. Use `getOptionalNumber('TIMEOUT_MS')` for the call timeout.
- Prefer `HttpClient` (`core/http/httpClient.ts`), as `cdogs-v2` and `cdogs-v3` do. It applies the shared timeout, throws `HttpClientError` or `HttpClientTimeoutError`, and can attach a service token. `postJsonForBinary` returns the response bytes. `get` returns nothing: any 2xx is success, and the body is discarded.
- `HttpClient.get` is the wrong health check when a 200 might not be your service. `cstar-v1` uses `fetch` with `joinUrl`, `resolveTimeoutMs`, and `AbortSignal.timeout`, throws `HttpClientError` on a non-2xx, and accepts the body only when it parses as `{ apiStatus: string }`. A CSTAR base URL missing `/api` reaches the CSTAR frontend, which answers 200 with HTML. Form.io's readiness treats 404 as success. Don't copy that.
- If the caller's payload can make the service return 400, 415, or 422, map the failure with `httpErrorToAppError` (`cdogs-v2`). That helper puts up to 500 characters of the upstream body on the client error. If the caller sent nothing the service could reject, do what `cstar-v1` does: `log.warn` the status and the error message, and throw `ServiceUnavailableError` with the status only.
- Parse the success body with Zod and return the lib type.
- `encodeURIComponent` any path segment that comes from the caller.
- A `post-submission-action` plugin keeps its options schema in `lib/src/schemas/postSubmission.ts`, beside the rules its After Submission drawer uses, such as the email action's address rule and list limit. The drawer is an entry in `frontend/src/features/post-submission/actions/registry.ts` with its text under `postSubmission` in `en.json` and `fr.json`; until it has one, the tab shows the action read-only.

## 5. The consumer

- Route, `validateRequest`, controller, service, in a core or feature module. Data about the caller goes under `/me`.
- Read the caller with `getActorId`, `getActorIdpCode`, and `getActorIdpAttributes` from `core/middleware/actor.ts`. When a plugin calls a service as the user, the controller reads the token with `getToken(req)` from `core/auth/IdpPlugin.ts`, the function the auth middleware uses, and passes it to the adapter. `GET /me/tenants` does this.
- Shapes shared with the frontend go in `lib/src/schemas/` and are re-exported from `lib/src/index.ts`, with an `export type`. The backend clones a lib schema with `.openapi('<Module>_<Name>')`. A composite response is `.extend()` on those named children, so the spec uses `$ref`. Add the composite to `backend/tests/core/api/shared/libSchemaOpenApi.test.ts`. A new `core/api/<name>/schema.ts` module also needs a row in `libSchemaLoadOrder.test.ts`.
- List the statuses the handler returns. `GET /me/tenants` documents 200, 400, and 503. 401 is `checkJwt`, and that path does not repeat it.

## 6. Configuration

- `backend/.env.example`: the codes, which one is the default, and the `PLUGIN_<CODE>_*` keys, next to the other `*_DEFAULT_CODE` lines. Devcontainer post-start copies this file to `backend/.env` when the example is new, and again when the example's hash changes (the previous `.env` is kept as `.env.prev`). An existing `.env` with no hash marker is left as it is.
- `backend/.env.local.example`: local overrides. Post-start syncs that file the same way. Secrets for local runs go here, not in `.env.example`.
- Helm, same layout as document generation and `configmap-tenant-engine.yaml`:
  - `values.yaml`: `backend.config.<kind>DefaultCode` set to the noop, and a `backend.<kind>` block with one entry per plugin. Leave the URLs empty.
  - `templates/backend/configmap-<kind>.yaml`. Emit a key only when the value is set (`{{- with ... }}`).
  - `templates/backend/deployment.yaml`: a `checksum/config-<kind>` annotation and an `envFrom` entry.
  - A Temporal worker gets only the ConfigMaps listed in `templates/temporal/deployment-worker.yaml` (temporal, backend-app, backend-formio, backend-sso, backend-ratelimit). Document generation and the tenant engine are not on that list. Add yours if a worker calls the plugin.
  - `values-dev.yaml`, `values-pr.yaml`, `values-test.yaml`, `values-prod.yaml`: the code and URLs for that environment. A timeout set in `values.yaml` applies to every environment unless one overrides it.
  - A row in `deployments/helm/soba/README.md` for each value.
- A secret follows the `soba-cdogs` Vault annotations on the backend Deployment: a template, `source` it from the container command, and a README row. `cstar-v1` has no secret. It sends the user's token.

## 7. Tests

- Registry, with real discovery and `process.env`, as in `tests/core/integrations/document-generation/DocumentGenerationRegistry.test.ts` and `tests/core/integrations/tenant/TenantEngineRegistry.test.ts`. The catalog contains the plugins, an unknown code throws, the default is the noop, and a plugin missing config is not ready.
- Adapter, with `createPluginConfigReaderFrom` and `createEnvReader`, against an in-process HTTP server, as in `tests/plugins/cstar-v1`. Cover success, each failure status, a non-JSON body, a timeout, and readiness.
- Route: supertest with authentication stubbed and the rest real, as in `tests/core/api/me/tenants.supertest.test.ts`.
- Noop: code and return value, as in `tests/plugins/docgen-noop` and `tests/plugins/tenant-noop`.
- ESLint rejects a nested `describe`. Keep `it` blocks flat.

## 8. Verify

From a terminal in the devcontainer, at the repo root (`/workspaces/soba`):

```bash
pnpm build:lib && pnpm test:lib
```

```bash
pnpm check:backend && pnpm test:backend
```

```bash
pnpm format:check
```

```bash
for f in dev pr test prod; do helm template soba deployments/helm/soba -f deployments/helm/soba/values-$f.yaml > /dev/null && echo "values-$f.yaml ok"; done
```

Start the backend with the "SOBA Backend" launch configuration. Under the API base path (`/chefs` locally): `/api/v1/meta/plugins` shows the plugin enabled, `/api/v1/health/ready` includes the kind, the startup log has its readiness line, and one request works on the noop and one on the real plugin.

## Gotchas

- `pnpm dev` runs `tsc` into `backend/dist` and does not delete old output. After a rename or removal, the old `dist/src/plugins/<old>` directory still loads and still shows in `/meta/plugins` until you delete it.
- The backend imports `@soba/lib` from `lib/dist`. Rebuild lib after a schema change or the new export is missing.
- `jest.setup.ts` loads `backend/.env`, then `backend/.env.local` over it. A test that cares about a variable sets or deletes it, and puts `process.env` back in `afterEach`.
- A plugin that fails to load, or exports a definition Zod rejects, is logged and skipped. Startup continues. Search the log for `[PluginRegistry]`.
- Readiness for a registry kind runs every installed plugin of that kind, not only the selected one. A plugin with no config is reported not ready in the startup log and on `/health/ready`.
- Renaming a code means renaming env keys and the Helm template. A form engine code is also stored on the form (`form_engine_code`).

Credential issuance follows the dedicated-registry model: `CREDENTIAL_ISSUER_DEFAULT_CODE` selects the implementation, falling back to `credential-issuer-noop`. See [Credential issuer](credential-issuer.md).
