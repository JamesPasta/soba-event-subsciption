{{/*
Chart name, truncated to 63 chars.
*/}}
{{- define "soba.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Fully qualified app name: <chart>-<release>.
If release name already contains the chart name, avoid duplication.
Truncated to 63 chars (K8s label limit).
*/}}
{{- define "soba.fullname" -}}
{{- if .Values.fullnameOverride }}
  {{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
  {{- $name := default .Chart.Name .Values.nameOverride }}
  {{- if contains $name .Release.Name }}
    {{- .Release.Name | trunc 63 | trimSuffix "-" }}
  {{- else }}
    {{- printf "%s-%s" $name .Release.Name | trunc 63 | trimSuffix "-" }}
  {{- end }}
{{- end }}
{{- end }}

{{/*
Common labels applied to every resource.
Usage: {{ include "soba.labels" (dict "root" . "component" "backend") }}
*/}}
{{- define "soba.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .root.Chart.Name .root.Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
app.kubernetes.io/name: {{ include "soba.name" .root }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/version: {{ .root.Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .root.Release.Service }}
{{- if .component }}
app.kubernetes.io/component: {{ .component }}
{{- end }}
{{- end }}

{{/*
Selector labels (immutable, used in matchLabels and pod template).
Usage: {{ include "soba.selectorLabels" (dict "root" . "component" "backend") }}
*/}}
{{- define "soba.selectorLabels" -}}
app.kubernetes.io/name: {{ include "soba.name" .root }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
{{- if .component }}
app.kubernetes.io/component: {{ .component }}
{{- end }}
{{- end }}

{{/*
Resource-policy annotation: "keep" unless global.forceCleanup is true.
*/}}
{{- define "soba.keepPolicy" -}}
{{- if not .Values.global.forceCleanup }}
"helm.sh/resource-policy": keep
{{- end }}
{{- end }}

{{/*
Construct the Form.io base URL.
If formio is internal, point at the in-cluster service; otherwise use formio.external.url.
*/}}
{{- define "soba.formioBaseUrl" -}}
{{- if .Values.formio.internal.enabled }}
  {{- printf "http://%s-formio:%v" (include "soba.fullname" .) (.Values.formio.service.port | default 3001) }}
{{- else }}
  {{- .Values.formio.external.url }}
{{- end }}
{{- end }}

{{/*
Construct the MongoDB URI.
If mongodb is internal, point at the in-cluster service; otherwise use mongodb.external.uri.
*/}}
{{- define "soba.mongodbUri" -}}
{{- if .Values.mongodb.internal.enabled }}
  {{- printf "mongodb://%s-mongodb:%v/formio-ce" (include "soba.fullname" .) (.Values.mongodb.service.port | default 27017) }}
{{- else }}
  {{- .Values.mongodb.external.uri }}
{{- end }}
{{- end }}

{{/*
Public host shared by every frontend app (Route / Ingress); apps are told apart by routePath.
Usage: {{ include "soba.frontendHost" $root }}
*/}}
{{- define "soba.frontendHost" -}}
{{- .Values.frontend.host | default (printf "%s.%s" (include "soba.fullname" .) .Values.global.domain) -}}
{{- end }}

{{/*
Path a named frontend app is served under, e.g. /designer.
Usage: {{ include "soba.frontendRoutePathFor" (dict "root" $root "name" "forms") }}
*/}}
{{- define "soba.frontendRoutePathFor" -}}
{{- $app := index .root.Values.frontend.apps .name | default dict -}}
{{- $app.routePath | default "" -}}
{{- end }}

{{/*
Public https:// URL for a named frontend app. Backend and frontend both read these, so both take
them from here and cannot drift.
Usage: {{ include "soba.frontendAppUrlFor" (dict "root" $root "name" "forms") }}
*/}}
{{- define "soba.frontendAppUrlFor" -}}
{{- printf "https://%s%s" (include "soba.frontendHost" .root) (include "soba.frontendRoutePathFor" (dict "root" .root "name" .name)) -}}
{{- end }}

{{/*
The https:// origin every frontend app shares. Feeds the backend CORS allowlist.
*/}}
{{- define "soba.frontendOrigins" -}}
{{- printf "https://%s" (include "soba.frontendHost" .) -}}
{{- end }}

{{/*
Backend public URL host (browser and NEXT_PUBLIC_SOBA_API_BASE_URL).
*/}}
{{- define "soba.backendHost" -}}
{{- printf "%s-api.%s" (include "soba.fullname" .) .Values.global.domain }}
{{- end }}

{{/*
URL path the API is served under (e.g. /chefs). Blank serves at the host root.
*/}}
{{- define "soba.backendBasePath" -}}
{{- .Values.backend.basePath | default "" -}}
{{- end }}

{{/*
Cluster-internal API base URL for Next.js SSR (Server Components) — plain HTTP to backend Service.
See frontend SOBA_API_INTERNAL_URL in runtimeConfig. Override with frontend.internalApiBaseUrl if needed.
*/}}
{{- define "soba.sobaApiInternalBaseUrl" -}}
{{- printf "http://%s-backend.%s.svc.cluster.local:%v%s/api/v1" (include "soba.fullname" .) .Release.Namespace (.Values.backend.service.port) (include "soba.backendBasePath" .) }}
{{- end }}

{{/*
Database secret name and key.
*/}}
{{- define "soba.dbSecretName" -}}
{{- if .Values.database.existingSecretName }}
{{- .Values.database.existingSecretName }}
{{- else }}
{{- printf "%s-db" (include "soba.fullname" .) }}
{{- end }}
{{- end }}

{{- define "soba.dbSecretKey" -}}
{{- if .Values.database.existingSecretName }}
{{- .Values.database.existingSecretKey }}
{{- else }}
DATABASE_URL
{{- end }}
{{- end }}

{{/*
Truthy ("true") only when the tempstorage-mount plugin is selected. Gates the
temp PVC, its mount, and PLUGIN_TEMPSTORAGE_MOUNT_DIR off one value so they
cannot drift apart. Any other code (e.g. tempstorage-os) needs no PVC.
*/}}
{{- define "soba.tempStorageUsesMount" -}}
{{- if eq .Values.backend.config.tempStorageDefaultCode "tempstorage-mount" -}}true{{- end -}}
{{- end }}

{{/*
Truthy ("true") only when css-v1 is an enabled user search plugin. Gates the CSS Vault secret,
which must hold PLUGIN_CSS_V1_CLIENT_ID and PLUGIN_CSS_V1_CLIENT_SECRET when it is injected.
*/}}
{{- define "soba.userSearchUsesCss" -}}
{{- if has "css-v1" (splitList "," (nospace .Values.backend.config.userSearchPlugins)) -}}true{{- end -}}
{{- end }}

{{/*
Truthy ("true") only when the default storage profile is storage-local. Gates the
file store PVC, its mount, and STORAGE_PROFILE_DEFAULT_BASE_PATH off one value so they
cannot drift apart.
*/}}
{{- define "soba.storageUsesLocal" -}}
{{- if eq .Values.backend.storage.defaultBackend "storage-local" -}}true{{- end -}}
{{- end }}

{{/*
Truthy ("true") only when the default storage profile is storage-s3 with its credentials in Vault
(s3VaultKeyInfix set). Gates the S3 Vault secret and the backend sourcing it off one value so they
cannot drift apart.
*/}}
{{- define "soba.storageUsesS3Vault" -}}
{{- if and (eq .Values.backend.storage.defaultBackend "storage-s3") .Values.backend.storage.s3VaultKeyInfix -}}true{{- end -}}
{{- end }}

{{/*
Fails the render on storage values the backend would refuse, or that would lose files:
storage-memory keeps files in one process, so it cannot back more than one replica; key prefixes
are lowercase words joined by dashes, in slash-separated segments; the storage-local base path is
absolute.
*/}}
{{- define "soba.validateStorage" -}}
{{- $storage := .Values.backend.storage -}}
{{- $prefix := "^[a-z0-9]+(-[a-z0-9]+)*(/[a-z0-9]+(-[a-z0-9]+)*)*$" -}}
{{- if and (eq $storage.defaultBackend "storage-memory") (or (gt (int .Values.backend.replicas) 1) .Values.backend.autoscaling.enabled) -}}
{{- fail "backend.storage.defaultBackend storage-memory keeps files in one process; use storage-local or storage-s3 with more than one replica or with autoscaling" -}}
{{- end -}}
{{- if and (eq $storage.defaultBackend "storage-local") $storage.defaultBasePath (not (hasPrefix "/" $storage.defaultBasePath)) -}}
{{- fail "backend.storage.defaultBasePath must be an absolute path" -}}
{{- end -}}
{{- if and (eq $storage.defaultBackend "storage-s3") $storage.defaultPrefix (not (regexMatch $prefix (toString $storage.defaultPrefix))) -}}
{{- fail "backend.storage.defaultPrefix must be lowercase words joined by dashes, in slash-separated segments" -}}
{{- end -}}
{{- if and (include "soba.storageUsesS3Vault" .) (not .Values.vault.enabled) -}}
{{- fail "backend.storage.s3VaultKeyInfix needs vault.enabled=true to inject the S3 secrets" -}}
{{- end -}}
{{- range $key := list "filesStoragePrefix" "templatesStoragePrefix" -}}
{{- $value := index $storage $key -}}
{{- if and $value (not (regexMatch $prefix (toString $value))) -}}
{{- fail (printf "backend.storage.%s must be lowercase words joined by dashes, in slash-separated segments" $key) -}}
{{- end -}}
{{- end -}}
{{- end }}

{{/*
Truthy ("true") only when the backend scans with clamav. Gates the clamav alias
Service and the PLUGIN_VIRUSSCAN_CLAMAV_* env together so they cannot drift apart.
Any other code (e.g. virusscan-noop) needs no clamav wiring.
*/}}
{{- define "soba.virusScanUsesClamav" -}}
{{- if eq .Values.backend.config.virusScanDefaultCode "virusscan-clamav" -}}true{{- end -}}
{{- end }}

{{/*
Truthy ("true") only when the backend caches with cache-redis. Gates the PLUGIN_CACHE_REDIS_URL
env. Any other code (e.g. cache-memory) needs no cache wiring.
*/}}
{{- define "soba.cacheUsesRedis" -}}
{{- if eq .Values.backend.config.cacheDefaultCode "cache-redis" -}}true{{- end -}}
{{- end }}

{{/*
Truthy ("true") only when the backend runs the message bus on messagebus-redis. Gates the
PLUGIN_MESSAGEBUS_REDIS_* env. Any other code (e.g. messagebus-memory) needs no bus wiring.
*/}}
{{- define "soba.messagebusUsesRedis" -}}
{{- if eq .Values.backend.config.messagebusDefaultCode "messagebus-redis" -}}true{{- end -}}
{{- end }}

{{/*
Truthy ("true") only when the backend runs event streams on eventstream-redis. Gates the
PLUGIN_EVENTSTREAM_REDIS_* env. Any other code (e.g. eventstream-memory) needs no stream wiring.
*/}}
{{- define "soba.eventstreamUsesRedis" -}}
{{- if eq .Values.backend.config.eventStreamDefaultCode "eventstream-redis" -}}true{{- end -}}
{{- end }}

{{/*
Truthy ("true") when anything (cache, message bus or event stream) needs Valkey. Gates the single
valkey alias Service, which they share — so it exists whenever any is on redis and never drifts.
*/}}
{{- define "soba.usesValkey" -}}
{{- if or (eq .Values.backend.config.cacheDefaultCode "cache-redis") (eq .Values.backend.config.messagebusDefaultCode "messagebus-redis") (eq .Values.backend.config.eventStreamDefaultCode "eventstream-redis") -}}true{{- end -}}
{{- end }}

{{/*
Feature status env vars for the backend, consumed by the seed step.

Must stay inline: the only consumer is a pre-install/pre-upgrade hook Job, and Helm creates hook
resources before ConfigMaps.

Name normalization matches featureEnvName() in backend/src/core/db/featureFlags.ts. An unrecognised
value fails the render, so a typo or an unquoted YAML boolean cannot pass as "no opinion". The
status list mirrors active rows in soba.feature_status; keep the two in step.
*/}}
{{- define "soba.featureEnv" -}}
{{- $valid := list "enabled" "disabled" "experimental" "deprecated" -}}
{{- range $code, $value := .Values.backend.features }}
{{- $status := "" }}
{{- if $value }}{{ $status = toString $value }}{{ else if kindIs "bool" $value }}{{ $status = toString $value }}{{ end }}
{{- if and $status (not (has $status $valid)) }}
{{- fail (printf "backend.features.%s: %s is not a feature status. Use one of: %s (quoted)." $code $status (join ", " $valid)) }}
{{- end }}
- name: FEATURE_{{ regexReplaceAll "[^A-Z0-9]" (upper $code) "_" }}_STATUS
  value: {{ $status | quote }}
{{- end }}
{{- end }}

{{/*
An optional setting as a quoted string, or nothing when it is "" or unset. 0 renders. Helm reads
unquoted numbers in values files as floats, so whole numbers are printed without an exponent.
*/}}
{{- define "soba.optionalSetting" -}}
{{- if kindIs "float64" . -}}
{{ printf "%.0f" . | quote }}
{{- else if and (not (kindIs "invalid" .)) (ne (toString .) "") -}}
{{ toString . | quote }}
{{- end -}}
{{- end }}

{{/*
An hourly email limit for post-submission-email-addresses, from (dict "name" <values key> "value"
<value>): nothing when "" or unset, else a whole number from 100 to 1000000 as a quoted string.
Anything else fails the render, so a bad value cannot quietly keep the plugin from loading.
*/}}
{{- define "soba.hourlyEmailLimit" -}}
{{- $raw := include "soba.optionalSetting" .value | trimAll "\"" -}}
{{- if $raw -}}
{{- if or (not (regexMatch "^[0-9]+$" $raw)) (lt (atoi $raw) 100) (gt (atoi $raw) 1000000) -}}
{{- fail (printf "backend.config.%s must be a whole number from 100 to 1000000, got %q" .name $raw) -}}
{{- end -}}
{{ $raw | quote }}
{{- end -}}
{{- end }}
