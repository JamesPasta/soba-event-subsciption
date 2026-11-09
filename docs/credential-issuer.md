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

The feature calling this adapter must authorize the caller, reserve a credential record before
issuing, persist consumer ownership, and reconcile uncertain outcomes. The plugin itself adds no
routes, database records, or incoming API-key authentication. The API keys settings group below
provides the management API and metadata persistence. ACL groups only apply to the
`kong-api-key-acl` flow. Labels are administrative metadata, not authorization.

## Configuration

`CREDENTIAL_ISSUER_DEFAULT_CODE` defaults to `credential-issuer-noop`. The no-op needs no config,
reports `available: false`, and throws `ServiceUnavailableError` on both operations. Like the other
no-op plugins it has no readiness check, so it reports ready.
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
OAuth scopes, when required, come from the service account's default scopes.

In Helm, set `backend.config.credentialIssuerDefaultCode` and `backend.credentialIssuer.apsCredentialIssuerV3`.
The base chart defaults to the no-op; dev, PR and test select APS. Each environment declares its APS
connection settings and gateway ID. PR reads dev's Vault secret, so it uses dev's gateway and product
environment appId. Select APS for an environment once its Vault secret holds the keys below. Vault
injects `PLUGIN_APS_CREDENTIAL_ISSUER_V3_CLIENT_ID`, `PLUGIN_APS_CREDENTIAL_ISSUER_V3_CLIENT_SECRET` and
`PLUGIN_APS_CREDENTIAL_ISSUER_V3_ENVIRONMENT_APP_ID` only when APS is selected, and a missing key keeps the
backend pod from starting. Without Vault, supply these keys through an existing deployment
secret/environment mechanism; do not put them in ConfigMaps or values files.

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
5. Add it to the deployment's Vault secret as `PLUGIN_APS_CREDENTIAL_ISSUER_V3_ENVIRONMENT_APP_ID`.
   For local development, set that variable in `backend/.env.local` instead.

Repeat the lookup for each deployment's gateway; do not reuse another environment's appId, except
on PR, which shares dev's.
Once the Vault secret holds the appId and credentials, select `aps-credential-issuer-v3` through
`backend.config.credentialIssuerDefaultCode` to enable issuance for that deployment.

## Operations and health

Issue calls `POST /gateways/{gatewayId}/consumers`; regeneration calls
`PUT /gateways/{gatewayId}/consumers/{clientId}?action=regenerate`. Only API-key flows are accepted.
The Directory API has no delete, disable or revoke operation for consumers. Removing a consumer is
manual, on the gateway's Consumers page.

Token acquisition is cached through the shared OAuth provider. An explicit 401 clears the cache
and permits one retry within the same operation deadline. Timeouts and other failures are not
retried: the gateway may already have created or rotated the credential. A 4xx answer is a refusal
and is reported as `CredentialRequestRejectedError`, as is failing to get a token, since nothing then
reaches the gateway; anything else, including a malformed success
response, leaves the outcome unknown.

`/meta/plugins` marks the selected issuer. Startup and `/health/ready` report all installed issuers,
like tenant engines, without affecting readiness HTTP status. APS readiness obtains a token only;
it does not prove Directory API reachability or gateway issuance permission. No credentials are
issued by health checks. Upstream response bodies and raw errors are not exposed by this adapter.

## API keys settings group

API keys are a fixed feature, `api-keys`, off by default and on in dev, PR and test. Turn it on where an issuer is
configured (`FEATURE_API_KEYS_STATUS`, or `backend.features.api-keys` in Helm); the designer app also
lists it in its frontend feature allowlist. The group is a form settings module at the `api-keys` key, so it
is served at both levels, relative to the API base (normally `/chefs/api/v1`):

| Method | Path                                    | Response                                          |
| ------ | --------------------------------------- | ------------------------------------------------- |
| GET    | `<base>`                                | `{ available, items, page, filters, sort }`       |
| POST   | `<base>`                                | 201 `{ credential, apiKey }`                      |
| GET    | `<base>/:credentialId`                  | the key's metadata                                |
| PATCH  | `<base>/:credentialId`                  | the key's metadata after the save                 |
| POST   | `<base>/:credentialId/regenerate`       | 200 `{ credential, apiKey }`                      |
| DELETE | `<base>/:credentialId`                  | 204                                               |

`<base>` is `/workspaces/:id/settings/api-keys` or `/design/forms/:id/settings/api-keys`.
Permissions are those of every settings group. A form's keys are read with `form_read` and changed
with `form_update`. A workspace's keys are read by any member and changed by owners and admins.
A key is only ever returned by generate and regenerate, so the change permission also decides who
sees one.

A form's list holds the workspace's keys as well as its own; each item's `scope` says which. The
form can read its workspace's keys but not change them: a form-level read or write of a workspace
key answers 404. A workspace's list holds only its own keys.

POST and PATCH take `{ label, notes, types }`: a trimmed nonempty label (maximum 100 characters),
notes (maximum 1000 characters; empty is allowed), and one or both distinct types, `api` and
`web-component`. Types are intended-use metadata. Nothing in this service reads an incoming key or
enforces its types, and no gateway ACL is derived from them. Upstream configuration, consumer IDs
and access groups cannot be supplied by the caller. The service names each consumer
`soba-workspace-<workspace UUID>-<credential UUID>` and labels it with the workspace and credential
ids, and the form id for a form's key.

List queries accept `offset` (default 0), `limit` (default 20, maximum 100), `q` (label and notes),
`sort` (label, status or creation time; default `createdAt:desc`) and `locale`. Cursor paging is
rejected. Rows and the total are read from one snapshot.

`available` is false when the default issuer cannot be built from its configuration or cannot
generate keys, as with the no-op. It is not a live readiness check. Metadata holds `id`, `scope`,
`label`, `notes`, `types`, `status`, `createdAt`, `updatedAt` and nullable `rotatedAt`, never the
consumer ID or issuer settings. Every response of the group carries `Cache-Control: no-store`.

## Key lifecycle

The database stores metadata and secret-free audit events (`credential_audit`) only; API keys are
never persisted. Types are rows in `credential_type_assignment`, one per type, referencing the
seeded `credential_type` catalog. A form's key has a composite foreign key requiring the form to be
in the key's workspace.

Each operation reserves the key before it calls the issuer:

- Generate writes the key as `issuing`, with its types and audit, in one transaction.
- Regenerate and delete move an `active` key to `rotating`. A key in any other status refuses both
  with 409, except that a `failed` key can be deleted.

When the issuer succeeds, the key returns to `active`: generate records the consumer ID and flow,
regenerate sets `rotatedAt`, and delete also sets `deleted_at` and `deleted_by`. When the issuer
refuses, a new key becomes `failed` and an existing key returns to `active`, still working. Any
other failure, or a failure to record the result, leaves the key `unknown`. A process crash can
leave `issuing` or `rotating`. Diagnostics name the key, workspace, issuer, operation and failed
stage (`upstream` or `persistence`), with an upstream HTTP status when there is one, and the
consumer ID when the issuer answered but the result could not be recorded; raw errors,
upstream bodies and keys are never logged.

Delete cannot revoke, so it regenerates the key and discards the new value: the old key stops
working at once, and nobody receives the new one. The consumer stays in the gateway until it is
removed on the Consumers page. If the gateway answers that it no longer has the consumer (404 or
410), the delete completes without a rotation, is audited as `delete_consumer_missing` and logged
with the consumer ID. A `failed` key has no consumer, so deleting it only marks the row deleted.
Deleted rows are kept for their audit and left out of every list.

Changing the configured gateway ID strands existing keys. The new gateway answers 404 for their
consumers, so a delete completes here while the key still works on the old gateway. Remove those
consumers on the old gateway's Consumers page.

### Operator reconciliation

No reconciliation endpoint is exposed. For an `unknown`, `issuing` or `rotating` key, check the APS
consumer by its application name and the configured environment, and confirm that no operation is
still in flight. If the consumer exists, record its ID and flow and set the key `active`; the owner
can then regenerate to get a new key. If no consumer was created, set the key `failed` so the owner
can delete it. Record the change in `credential_audit` with the responsible actor. Do not reset
a key without checking: a timeout may follow a successful creation or rotation.

Dev-data purge deletes credential audit rows and type assignments before the keys. It removes
local metadata only; their consumers stay in the gateway.

## Settings drawers

Workspace > Form Settings > API Keys lists the workspace's keys; a form's Settings > API Keys lists
the workspace's keys, read-only, and the form's own. Each drawer follows the Groups tab: search and
Add API Key above a server-paged table, Edit and Delete on the rows the drawer owns, and the add or
edit form below the table. Delete is offered for `active` and `failed` keys.

The add form takes the label, notes and types. Generate API Key creates the key and shows it once in
a modal with a Copy button; Save then stores any change to the label, notes and types, and stays
disabled until a key has been generated. Once a key is generated, Regenerate API Key takes Generate's
place. The edit form has Regenerate API Key and Save; Regenerate is enabled only for an `active` key.
Regenerate opens the same modal to confirm first, then shows the new key in it; the modal cannot be
closed while the request runs. After a failed regenerate the form reads the key again and enables
Regenerate only if the key is still `active`. Once a key is shown, Escape and a backdrop click do not
close the modal, so the key is dropped only by Done or the close button. While a key is being issued
or shown, and until a newly generated key is saved or the add form is cancelled, Add and the row
actions are held off. The key is never written to the SWR cache, which holds metadata only.
