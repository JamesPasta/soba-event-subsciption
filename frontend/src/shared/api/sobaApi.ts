import type { FeaturesMetaPayload } from '@/src/shared/config/featuresMeta';
import { isFeaturesMetaPayload } from '@/src/shared/config/featuresMeta';
import { getSobaApiBaseUrl } from '../config/runtimeConfig';
import { parseJson } from './sobaHelpers';
import { sobaFetch } from './sobaFetch';

import type {
  WorkspaceItem,
  WorkspacesResponse,
  WorkspaceLookupResponse,
  CreateWorkspaceBody,
  UpdateWorkspaceBody,
  WorkspaceNameAvailabilityResponse,
} from '../../types/workspaces';
import type { CurrentUserResponse } from '../../types/user';
import type { SortLocale } from '@soba/lib/sort';
import type { LoginProvidersMetaResponse, RolesMetaResponse } from '@soba/lib';
import type { ListQueryArgs } from '../../types/list';
import { sortLocaleHeaders } from './sortLocaleRequest';

export type { SobaFormType } from '../../types/forms';
export type { WorkspaceItem, WorkspacesResponse } from '../../types/workspaces';
export type { CurrentUserResponse } from '../../types/user';
// Design-mode (staff, /design/*)
export {
  createSobaFormioForm,
  publishSobaFormVersion,
  getSobaForm,
  getSobaForms,
  getSobaSubmissions,
  getSobaSubmission,
  getSobaSubmissionData,
  lookupFormVersions,
  getSobaFormVersion,
  getSobaFormVersionPage,
  createFormVersion,
  saveFormVersionSchema,
  getFormVersionSchema,
  updateSobaForm,
  deleteSobaSubmission,
  deleteSobaForm,
  getSobaSubmissionReview,
  addSobaSubmissionNote,
  updateSobaSubmissionStatus,
  getSobaSubmissionReviewers,
  downloadSobaSubmissionFile,
  updateSobaSubmissionData,
  getSobaExportFields,
  startSobaSubmissionExport,
  listSobaSubmissionExports,
  stopSobaSubmissionExport,
  downloadSobaSubmissionExport,
} from './sobaApiDesign';
// Submit-mode (public-capable, /submit/*)
export {
  getSubmitFillBundle,
  getSubmitForm,
  getSubmitFormVersionSchema,
  getSubmitSubmissionSchema,
  openSobaFormSubmission,
  saveSobaFormSubmission,
  submitSobaFormSubmission,
  deleteSubmitSubmission,
  reviseSubmitSubmission,
  getMyForms,
  getMySubmissions,
  getMyWorkspaces,
  getSubmitSubmission,
  getSubmitSubmissionData,
} from './sobaApiSubmit';
// Platform administration (soba_admin only, /admin/*)
export {
  fetchSobaAdmins,
  addSobaAdmin,
  fetchFeatureScope,
  fetchFeatureScopes,
  removeFeatureScope,
  removeSobaAdmin,
  upsertFeatureScope,
  fetchDocumentGenerationAudits,
} from './sobaApiAdmin';

export type BuildMeta = {
  name: string;
  version: string;
  nodeVersion: string;
  gitSha: string;
  gitTag: string;
  imageTag: string;
};

export async function fetchHealth(): Promise<{ status: string }> {
  const response = await fetch(`${getSobaApiBaseUrl()}/health`, {
    method: 'GET',
    cache: 'no-store',
  });
  return parseJson(response);
}

export async function fetchBuildMeta(): Promise<BuildMeta> {
  const response = await fetch(`${getSobaApiBaseUrl()}/meta/build`, {
    method: 'GET',
    cache: 'no-store',
  });
  return parseJson(response);
}

export async function fetchFeaturesMeta(): Promise<FeaturesMetaPayload> {
  const response = await fetch(`${getSobaApiBaseUrl()}/meta/features`, {
    method: 'GET',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
    },
  });
  const payload = await parseJson<unknown>(response);
  if (!isFeaturesMetaPayload(payload)) {
    throw new Error('Invalid features meta response');
  }
  return payload;
}

/** Readiness may return 503 with a JSON body; callers should not use `parseJson` alone. */
export async function fetchHealthReady(): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${getSobaApiBaseUrl()}/health/ready`, {
    method: 'GET',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  const body = (await response.json()) as unknown;
  return { status: response.status, body };
}

export async function fetchPluginsMeta(): Promise<unknown> {
  const response = await fetch(`${getSobaApiBaseUrl()}/meta/plugins`, {
    method: 'GET',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  return parseJson(response);
}

export async function fetchFormEnginesMeta(): Promise<unknown> {
  const response = await fetch(`${getSobaApiBaseUrl()}/meta/form-engines`, {
    method: 'GET',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  return parseJson(response);
}

/** The providers people sign in through, by name in the sort locale. */
export async function fetchLoginProviders(
  locale?: SortLocale,
): Promise<LoginProvidersMetaResponse> {
  const q = locale ? `?locale=${locale}` : '';
  const response = await fetch(`${getSobaApiBaseUrl()}/meta/login-providers${q}`, {
    method: 'GET',
    cache: 'no-store',
    headers: { Accept: 'application/json', ...sortLocaleHeaders(locale) },
  });
  return parseJson(response);
}

export async function fetchFrontendConfigMeta(): Promise<unknown> {
  const response = await fetch(`${getSobaApiBaseUrl()}/meta/frontend-config`, {
    method: 'GET',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  return parseJson(response);
}

export async function fetchCodesMeta(onlyEnabledFeatures = true): Promise<unknown> {
  const q = onlyEnabledFeatures ? '?only_enabled_features=true' : '';
  const response = await fetch(`${getSobaApiBaseUrl()}/meta/codes${q}`, {
    method: 'GET',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  return parseJson(response);
}

export async function fetchRolesMeta(onlyEnabledFeatures = true): Promise<RolesMetaResponse> {
  const q = onlyEnabledFeatures ? '?only_enabled_features=true' : '';
  const response = await fetch(`${getSobaApiBaseUrl()}/meta/roles${q}`, {
    method: 'GET',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  return parseJson(response);
}

export async function fetchWorkspaces(
  token: string,
  options: Partial<ListQueryArgs> = {},
): Promise<WorkspacesResponse> {
  const response = await sobaFetch('/workspaces', {
    token,
    query: {
      offset: options.offset,
      limit: options.limit,
      sort: options.sort,
      q: options.q || undefined,
      locale: options.locale,
    },
    headers: sortLocaleHeaders(options.locale),
  });
  return parseJson(response);
}

/** Workspaces for a select. The caller must hold every one of `requiredPermissions`. */
export async function lookupWorkspaces(
  token: string,
  options: {
    requiredPermissions?: readonly string[];
    disclaimerAccepted?: boolean;
    locale?: SortLocale;
  } = {},
): Promise<WorkspaceLookupResponse> {
  const response = await sobaFetch('/workspaces/lookup', {
    token,
    query: {
      requiredPermissions: options.requiredPermissions?.join(','),
      disclaimerAccepted: options.disclaimerAccepted,
      locale: options.locale,
    },
    headers: sortLocaleHeaders(options.locale),
  });
  return parseJson(response);
}

export async function selectWorkspace(token: string, id: string): Promise<WorkspaceItem> {
  const response = await sobaFetch(`/workspaces/${id}`, { token });
  const workspace = await parseJson<WorkspaceItem>(response);
  return workspace;
}

export async function fetchCurrentUser(token: string): Promise<CurrentUserResponse> {
  const response = await sobaFetch('/me', { token });
  return parseJson(response);
}

export async function createWorkspace(
  token: string,
  body: CreateWorkspaceBody,
): Promise<WorkspaceItem> {
  const response = await sobaFetch('/workspaces', { token, method: 'POST', json: body });
  return parseJson(response);
}

export async function updateWorkspace(
  token: string,
  id: string,
  body: UpdateWorkspaceBody,
): Promise<WorkspaceItem> {
  const response = await sobaFetch(`/workspaces/${id}`, { token, method: 'PATCH', json: body });
  return parseJson(response);
}

/** Whether a team workspace name is free in `org`, case-insensitively; `excludeId` is the workspace being edited. */
export async function checkWorkspaceNameAvailable(
  token: string,
  params: { org: string; name: string; excludeId?: string },
): Promise<WorkspaceNameAvailabilityResponse> {
  const response = await sobaFetch('/workspaces/name-availability', {
    token,
    query: { org: params.org, name: params.name, excludeId: params.excludeId },
  });
  return parseJson(response);
}
