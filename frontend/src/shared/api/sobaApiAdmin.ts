import { parseJson } from './sobaHelpers';
import { sobaFetch } from './sobaFetch';
import { toListRequestQuery, type ListQueryArgs } from '../../types/list';
import { sortLocaleHeaders } from './sortLocaleRequest';

import type {
  AddSobaAdminBody,
  DocumentGenerationAuditsQuery,
  DocumentGenerationAuditsResponse,
  FeatureScopeItem,
  FeatureScopesResponse,
  JobDetail,
  JobsQuery,
  JobsResponse,
  JobTypesResponse,
  SobaAdminsResponse,
  UpsertFeatureScopeBody,
} from '../../types/admin';

/**
 * Platform administration (`/admin/*`). Every route is guarded by `requireSobaAdmin` on the
 * backend, so a non-admin caller gets a 403 regardless of what the UI renders.
 */

export async function fetchSobaAdmins(
  token: string,
  args: ListQueryArgs,
): Promise<SobaAdminsResponse> {
  const response = await sobaFetch('/admin/soba-admins', {
    token,
    query: toListRequestQuery(args),
    headers: sortLocaleHeaders(args.locale),
  });
  return parseJson(response);
}

export async function addSobaAdmin(token: string, userId: string): Promise<void> {
  const body: AddSobaAdminBody = { userId };
  const response = await sobaFetch('/admin/soba-admins', {
    token,
    method: 'POST',
    json: body,
  });
  if (!response.ok) await parseJson(response);
}

/**
 * A 404 means the row was already gone, which is the outcome the caller asked for. Reporting it as
 * a failure would contradict the refreshed list.
 */
async function deleteResource(token: string, path: string): Promise<void> {
  const response = await sobaFetch(path, { token, method: 'DELETE' });
  if (!response.ok && response.status !== 404) await parseJson(response);
}

export async function removeSobaAdmin(token: string, userId: string): Promise<void> {
  await deleteResource(token, `/admin/soba-admins/${userId}`);
}

export async function fetchFeatureScopes(
  token: string,
  args: ListQueryArgs & {
    featureCode?: string;
    /** The features this deployment scopes. The rest are not the admin's to manage. */
    featureCodes?: string[];
    scopeType?: string;
    status?: string;
  },
): Promise<FeatureScopesResponse> {
  const response = await sobaFetch('/admin/feature-scopes', {
    token,
    query: {
      ...toListRequestQuery(args),
      featureCode: args.featureCode,
      featureCodes: args.featureCodes?.join(','),
      scopeType: args.scopeType,
      status: args.status,
    },
  });
  return parseJson(response);
}

export async function fetchFeatureScope(token: string, id: string): Promise<FeatureScopeItem> {
  const response = await sobaFetch(`/admin/feature-scopes/${id}`, { token });
  return parseJson(response);
}

export async function removeFeatureScope(token: string, id: string): Promise<void> {
  await deleteResource(token, `/admin/feature-scopes/${id}`);
}

/** Grants (or revokes, with `status: 'inactive'`) a scoped feature for a workspace or form. */
export async function upsertFeatureScope(
  token: string,
  body: UpsertFeatureScopeBody,
): Promise<void> {
  const response = await sobaFetch('/admin/feature-scopes', {
    token,
    method: 'POST',
    json: body,
  });
  if (!response.ok) await parseJson(response);
}

export async function fetchDocumentGenerationAudits(
  token: string,
  query: DocumentGenerationAuditsQuery,
): Promise<DocumentGenerationAuditsResponse> {
  const response = await sobaFetch('/admin/document-generation/audits', {
    token,
    query: {
      ...toListRequestQuery(query),
      workspaceId: query.workspaceId,
      formId: query.formId,
    },
  });
  return parseJson(response);
}

export async function fetchJobs(token: string, query: JobsQuery): Promise<JobsResponse> {
  const response = await sobaFetch('/admin/jobs', {
    token,
    query: {
      ...toListRequestQuery(query),
      status: query.status,
      type: query.type,
      workspaceId: query.workspaceId,
      formId: query.formId,
      submissionId: query.submissionId,
    },
  });
  return parseJson(response);
}

export async function fetchJobTypes(token: string): Promise<JobTypesResponse> {
  const response = await sobaFetch('/admin/jobs/types', { token });
  return parseJson(response);
}

export async function fetchJob(token: string, jobId: string): Promise<JobDetail> {
  const response = await sobaFetch(`/admin/jobs/${jobId}`, { token });
  return parseJson(response);
}

/** Queues a dead or cancelled job again; a 409 says why it cannot run again. */
export async function rerunJob(token: string, jobId: string): Promise<JobDetail> {
  const response = await sobaFetch(`/admin/jobs/${jobId}/rerun`, { token, method: 'POST' });
  return parseJson(response);
}

/**
 * Stops a queued or running job. `stopped` is false while a running job has yet to reach its next
 * heartbeat (202).
 */
export async function stopJob(
  token: string,
  jobId: string,
): Promise<{ stopped: boolean; job: JobDetail }> {
  const response = await sobaFetch(`/admin/jobs/${jobId}/cancel`, { token, method: 'POST' });
  const job = await parseJson<JobDetail>(response);
  return { stopped: response.status === 200, job };
}
