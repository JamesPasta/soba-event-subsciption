# APS gateway check

Publishes a reverse proxy on the BC Gov API Gateway (APS) in front of a SOBA backend and
checks `/health` through it. The route has no gateway plugins, and the frontend still calls
the backend through its OpenShift route.

```text
https://<public host>/health
  -> http://<release>-backend.<namespace>.svc:4000/chefs/api/v1/health
```

Every path under the public host maps to `/chefs/api/v1`, so application authentication still
applies to everything except the public endpoints.

## How it runs

- `pr_open.yaml` calls `gateway-proxy-check.yaml` after the PR deploy when `APS_PR_ENABLED` is
  `true` in the `pr` environment or repository. The same variable enables the APS NetworkPolicy
  in that deploy.
- The workflow renders `service.template.yaml` with `scripts/generate-gateway-config.mjs` and
  publishes it with `gwa publish-gateway --qualifier proxy-proof-<release>`, which replaces only
  that qualifier's configuration.
- Gold PR routes use `soba-pr.api.gov.bc.ca/pr/<number>/`, e.g.
  `https://soba-pr.api.gov.bc.ca/pr/173/health`. Dev uses
  `https://soba-dev.api.gov.bc.ca/health`. Manual runs provide an explicit hostname.
- The check passes when `gwa status` reports the service `UP` and its `env_host` returns HTTP
  200 from `/health` with `status: OK`. The job summary records the URL.
- `pr_close.yaml` publishes `services: []` under the same qualifier and waits until the service
  is gone. Publishing and cleanup for a release share a concurrency group, and publishing is
  refused once the PR is closed.

## NetworkPolicy

`deployments/helm/soba/templates/backend/networkpolicy-aps.yaml` lets the APS namespace reach
backend pods on port 4000. PR and Dev values select the Gold APS namespace with labels
`name: b8840c` and `environment: prod`. Any other release needs `gatewayNetworkPolicy` enabled
in its values before a check; the workflow fails when `<release>-aps` is missing.

## Configuration

PR Open and PR Close read `APS_PR_ENABLED` in jobs that select the `pr` GitHub environment, so
it can be set there or at repository level. Other settings can be set on the repository or on
the selected GitHub environment.

| Kind | Name | Value |
| --- | --- | --- |
| Variable | `OC_NAMESPACE` | Namespace holding the release |
| Secret | `OC_TOKEN` | Can read deployments, services, endpoints, configmaps and networkpolicies |
| Secret | `GWA_CLIENT_ID`, `GWA_CLIENT_SECRET` | Service account with `GatewayConfig.Publish` on the selected environment's gateway |
| Variable | `OC_SERVER` | OpenShift API URL |
| Variable | `APS_HOST` | APS host, `api.gov.bc.ca` for Gold |
| Variable | `APS_GATEWAY_HOST_PREFIX` | PR or Dev host prefix (`soba-pr` or `soba-dev`) |
| Variable | `APS_GATEWAY_ID` | Gateway ID on the selected Gold APS instance |
| Variable | `GWA_LINUX_AMD64_SHA256` | SHA256 of `gwa_Linux_x86_64.tgz` from the [gwa-cli v3.2.0](https://github.com/bcgov/gwa-cli/releases/tag/v3.2.0) `checksums.txt` |

| Environment | Gateway | APS instance |
| --- | --- | --- |
| `pr` | `gw-d3969` | Gold |
| `dev` | `gw-93f93` | Gold |
| `test` | `gw-7f49d` | Gold |
| `prod` | not configured | Not configured |

## Manual check

Manual runs need the workflow on the default branch. Run **Gateway proxy check** with an
environment (`dev`, `pr` or `test`), an existing release, and a route hostname in the
`<name>.api.gov.bc.ca` form. Manual runs ignore `APS_PR_ENABLED`, and PR Close does not remove
their configuration.

## Cleanup

PR Close removes a PR's gateway configuration only while `APS_PR_ENABLED` is `true`, so keep it
on until every open PR's configuration is gone. To retry a failed cleanup, run **PR Close**
manually with the PR number. The NetworkPolicy is removed with the Helm release.

## Local rendering

Needs Node.js 20+ and no credentials.

```bash
export GATEWAY_ID=gw-d3969
export GATEWAY_QUALIFIER=proxy-proof-soba-pr-173
export GATEWAY_SERVICE_NAME=soba-proxy-proof-soba-pr-173
export GATEWAY_HOSTNAME=soba-pr.api.gov.bc.ca
export GATEWAY_ROUTE_PATH=/pr/173/
export BACKEND_HOST=soba-pr-173-backend.your-namespace.svc
node deployments/gateway/scripts/generate-gateway-config.mjs
```

## Troubleshooting

- Job skipped: `APS_PR_ENABLED` is not exactly `true`, or the deploy failed.
- Validation step exits 1 without a message: the release must start with `soba-` and be at most
  49 characters, and `OC_NAMESPACE` must be a valid namespace.
- `/health` fails: check the NetworkPolicy labels, ready backend endpoints, and any plugins
  inherited from the gateway.
