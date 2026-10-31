# Credential issuer

Backend code issues and regenerates gateway API keys through a dedicated registry, following
the tenant and document-generation integrations:

```ts
import { createDefaultCredentialIssuerAdapter } from "../core/integrations/credential-issuer/CredentialIssuerRegistry";

const issuer = createDefaultCredentialIssuerAdapter();
const credential = await issuer.issue({
  applicationName: "workspace-integration",
  labels: { "issued-by": "soba" },
  aclGroups: ["workspace-group"],
});
// Return credential.apiKey once; never log or persist it.
// Rotate with issuer.regenerate(credential.clientId).
```

The feature calling this adapter must authorize administrators, reserve a credential record
slot before issuing, persist consumer ownership, and reconcile uncertain outcomes. The plugin itself
adds no routes, database records, or incoming API-key authentication. The workspace service below
provides the management API and metadata persistence. ACL groups only apply to the
`kong-api-key-acl` flow. Labels are administrative metadata, not authorization.

## Configuration

`CREDENTIAL_ISSUER_DEFAULT_CODE` defaults to `credential-issuer-noop`. The no-op needs no config
and throws `ServiceUnavailableError` on both operations; its readiness reports unavailable.
Select `aps-credential-issuer-v3` to use the APS Directory API. Configure via `PluginConfigReader`:

| Setting                                              | Purpose                                                                   |
| ---------------------------------------------------- | ------------------------------------------------------------------------- |
| `PLUGIN_APS_CREDENTIAL_ISSUER_V3_API_BASE_URL`       | Directory API base URL including `/ds/api/v3`                             |
| `PLUGIN_APS_CREDENTIAL_ISSUER_V3_GATEWAY_ID`         | Issuer's gateway                                                          |
| `PLUGIN_APS_CREDENTIAL_ISSUER_V3_ENVIRONMENT_APP_ID` | Product environment's appId, not the product appId                        |
| `PLUGIN_APS_CREDENTIAL_ISSUER_V3_TOKEN_URL`          | OAuth service-account token endpoint                                      |
| `PLUGIN_APS_CREDENTIAL_ISSUER_V3_CLIENT_ID`          | Issuer service-account ID                                                 |
| `PLUGIN_APS_CREDENTIAL_ISSUER_V3_CLIENT_SECRET`      | Issuer service-account secret                                             |
| `PLUGIN_APS_CREDENTIAL_ISSUER_V3_TIMEOUT_MS`         | Optional operation deadline including token acquisition and one 401 retry |

The account needs `CredentialIssuer.Generate` on the configured gateway. Environment discovery
requires `Namespace.Manage`; perform it during setup rather than granting it to the runtime issuer.
OAuth scopes, when required, must currently be supplied by the service account's default scopes.

In Helm, set `backend.config.credentialIssuerDefaultCode` and `backend.credentialIssuer.apsCredentialIssuerV3`.
The base chart and every environment use the no-op. Each environment declares its APS connection
settings and gateway ID; dev and PR also have their product environment appIds. Select APS for an
environment once its appId and Vault credentials are supplied. Vault injects `PLUGIN_APS_CREDENTIAL_ISSUER_V3_CLIENT_ID` and
`PLUGIN_APS_CREDENTIAL_ISSUER_V3_CLIENT_SECRET` only when APS is selected. Without Vault, supply these keys through
an existing deployment secret/environment mechanism; do not put them in ConfigMaps or values files.

### Obtain the product environment appId

1. Log in to the [API Services Portal gateway manager](https://api.gov.bc.ca/manager/gateways/detail)
   with an account that has `Namespace.Manage` access to the gateway.
2. Using the same logged-in browser session, open
   [Get products in the Directory API console](https://api.gov.bc.ca/ds/api/v3/console/#/Products/get-products).
3. Click **Try it out** and enter the Gateway ID for the deployment environment. The gateway IDs
   are configured in `deployments/helm/soba/values-dev.yaml`, `values-pr.yaml`, `values-test.yaml`
   and `values-prod.yaml` under `backend.credentialIssuer.apsCredentialIssuerV3.gatewayId`.
4. Execute the request. In the response, find the appropriate service/product and its target
   environment, then copy `[].environments[].appId`. Use the environment's `appId`, not the
   product's top-level `appId`.
5. Set `backend.credentialIssuer.apsCredentialIssuerV3.environmentAppId` in the matching Helm
   values file. For local development, set `PLUGIN_APS_CREDENTIAL_ISSUER_V3_ENVIRONMENT_APP_ID`
   in `backend/.env.local` instead.

Repeat the lookup for each deployment's gateway; do not reuse another environment's appId.
Once the appId and Vault credentials are configured, select `aps-credential-issuer-v3` through
`backend.config.credentialIssuerDefaultCode` to enable issuance for that deployment.

## Operations and health

Issue calls `POST /gateways/{gatewayId}/consumers`; regeneration calls
`PUT /gateways/{gatewayId}/consumers/{clientId}?action=regenerate`. Only API-key flows are accepted.
There is no delete, disable, or revoke operation. Revocation is manual in the gateway portal.

Token acquisition is cached through the shared OAuth provider. An explicit 401 clears the cache
and permits one retry within the same operation deadline. Timeouts and other failures are not
retried: the gateway may already have created or rotated the credential. A malformed success
response likewise needs reconciliation before another issuance attempt.

`/meta/plugins` marks the selected issuer. Startup and `/health/ready` report all installed issuers,
like tenant engines, without affecting readiness HTTP status. APS readiness obtains a token only;
it does not prove Directory API reachability or gateway issuance permission. No credentials are
issued by health checks. Upstream response bodies and raw errors are not exposed by this adapter.

## Workspace and form credential API

Authenticated workspace owners and admins can use these endpoints, relative to the configured
API base (normally `/chefs/api/v1`):

| Method | Path                                                   | Response                                                   |
| ------ | ------------------------------------------------------ | ---------------------------------------------------------- |
| GET    | `/workspaces/:id/credentials`                          | `{ available, items, page, filters, sort }`, metadata only |
| POST   | `/workspaces/:id/credentials`                          | 201 `{ credential, apiKey }`                               |
| POST   | `/workspaces/:id/credentials/:credentialId/regenerate` | 200 `{ credential, apiKey }`                               |

Forms expose GET and POST at `/design/forms/:id/credentials`. Both require `form_update`
permission on the resolved form; workspace membership alone does not grant access. The server
resolves the workspace from the form, and rejects caller-supplied ownership fields. Each collection
lists only its own keys: workspace collections exclude form keys, and form collections exclude
workspace keys and sibling forms. Form keys are independent; inheritance/override semantics are
not implemented.

Creation accepts `{ label, notes, types }`: a trimmed nonempty label (maximum 100 characters),
notes (maximum 1000 characters; an empty string is allowed), and one or both distinct types,
`api` and `web-component`. Each POST creates an independent credential. Regeneration still accepts
`{}` for an existing credential; it is not exposed in the initial workspace UI.
Upstream configuration, consumer IDs and access groups cannot be supplied by the caller.
The service constructs `soba-workspace-<workspace UUID>-<credential UUID>` and administrative
workspace/credential labels so keys in the same workspace receive separate upstream identities.
Form credentials also include a server-derived `form-id` label.
Types are stored as intended-use metadata. Incoming API-key authentication and enforcement of
these types are not implemented by this creation ticket, and no gateway ACL mapping is inferred.

List queries accept `offset` (default 0), `limit` (default 20, maximum 100), `q`, `sort`
(default `createdAt:desc`) and `locale`. Cursor paging is rejected. Rows and the total are read
from one snapshot; the response echoes `page`, `filters` and `sort`.

`available` means the current default issuer can be constructed from configuration; it does not
perform a live readiness or permission check. Metadata contains `id`, `label`, `notes`, `types`,
`status`, `createdAt`, `updatedAt` and nullable `rotatedAt`. The response never exposes the upstream
consumer ID or issuer settings. All credential route responses use `Cache-Control: no-store`.
Clients keep returned keys out of shared caches, persistent state, notifications and telemetry.

The service reserves each record before issuance and atomically reserves an active record before
regeneration. A credential may belong to a form; a composite foreign key requires that form to be
in the credential's workspace. Types are rows in `credential_type_assignment`, one per type,
referencing the seeded `credential_type` catalog (`api`, `web-component`). A new credential row,
its type assignments and the issuance audit are written in one transaction. The database stores
metadata and secret-free audit events only; API keys are never persisted.

Statuses are `issuing`, `active`, `rotating`, and `unknown`. An unsuccessful upstream operation
or failed completion is treated as an uncertain outcome. There is no automatic retry or deletion
of the reservation. A process crash can leave `issuing` or `rotating`; these block operations on
that key, while other keys remain independent. If the browser loses a successful response, the
secret cannot be retrieved; an operator must reconcile the affected key.

Operation failure handling is separate from the service orchestration. Diagnostics identify the
credential, workspace, issuer, operation and failed stage (`upstream` or `persistence`), with an
upstream HTTP status when available. If recording `unknown` fails, a separate reconciliation error
is logged and the pending reservation remains. Raw errors, upstream bodies and API keys are never
included in these diagnostics.

### Operator reconciliation

No reconciliation or deletion endpoint is exposed. An operator must check the APS consumer using
the deterministic application name and configured environment, confirm that no operation remains
in flight, and reconcile its identity with the workspace credential record. If a consumer exists,
record the confirmed consumer ID and flow and restore `active`; the owner can then regenerate to
obtain a new key. Only remove an unused reservation after confirming no consumer was created.
Record the reconciliation in `credential_audit` with the responsible actor. Do not blindly reset
`unknown` or pending records: a timeout may follow a successful creation or rotation.

Dev-data purge deletes credential audit rows and type assignments before credential records. It removes
local metadata only; APS consumers must be revoked manually because the issuer has no revoke operation.

### Workspace and form settings UI

Workspace owners and admins open Workspace → Form Settings → API Keys. The drawer lists all
workspace keys in server-paged results and offers Add API key. Search matches labels and notes; sorting supports label, status and creation time. Forms have their own API Keys drawer in Settings,
using the same list, create form and one-time dialog for form-owned keys. The separate create form collects the label, optional notes,
and at least one type before generation. Fields and cancellation are disabled during issuance.
The key is held only in the secret dialog and cleared on close, logout, user change, workspace
change, form change or unmount. Routine access-token refreshes preserve the dialog. Copy writes to the clipboard
only when pressed. Metadata is cached separately; a failed refresh does not discard the secret.
`useCredentials` owns metadata reads and refresh; `useCredentialWriter` owns creation and
metadata refreshes. Both address the cache by resource kind, resource ID and user; read keys also include paging, search, sort and locale. Creation refreshes all cached pages in that scope. Failed writes refresh the
metadata without replaying issuance, and successful writes return the secret directly to the caller.

The drawer is live; the previous demo/preview and per-type singleton sections have been removed.
Inheritance/override behavior, metadata editing and rotation UI are deferred. The existing notes PATCH and
regeneration backend endpoints remain available and scope every operation to both workspace and
credential ID. Revocation remains an external action; the issuer has no revoke operation.
