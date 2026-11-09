import { parseJson } from './sobaHelpers';
import { sobaFetch } from './sobaFetch';
import { toListRequestQuery } from '../../types/list';
import type {
  JobFormsResponse,
  JobScopeRef,
  StaffJobDetail,
  StaffJobsQuery,
  StaffJobsResponse,
} from '../../types/jobs';

/** A form's jobs on the design surface; a workspace's on the core one. */
const jobsPath = (scope: JobScopeRef): string =>
  scope.kind === 'form'
    ? `/design/forms/${scope.formId}/jobs`
    : `/workspaces/${scope.workspaceId}/jobs`;

export async function fetchScopedJobs(
  token: string,
  scope: JobScopeRef,
  query: StaffJobsQuery,
): Promise<StaffJobsResponse> {
  const response = await sobaFetch(jobsPath(scope), {
    token,
    query: {
      ...toListRequestQuery(query),
      status: query.status,
      type: query.type,
      formId: scope.kind === 'workspace' ? query.formId : undefined,
    },
  });
  return parseJson(response);
}

/** The forms that have jobs in a workspace, for its list's form filter. */
export async function fetchJobForms(token: string, workspaceId: string): Promise<JobFormsResponse> {
  const response = await sobaFetch(`/workspaces/${workspaceId}/jobs/forms`, { token });
  return parseJson(response);
}

export async function fetchScopedJob(
  token: string,
  scope: JobScopeRef,
  jobId: string,
): Promise<StaffJobDetail> {
  const response = await sobaFetch(`${jobsPath(scope)}/${jobId}`, { token });
  return parseJson(response);
}

/** Queues a dead or cancelled job again; a 409 says why it cannot run again. */
export async function rerunScopedJob(
  token: string,
  scope: JobScopeRef,
  jobId: string,
): Promise<StaffJobDetail> {
  const response = await sobaFetch(`${jobsPath(scope)}/${jobId}/rerun`, {
    token,
    method: 'POST',
  });
  return parseJson(response);
}

/**
 * Stops a queued or running job. `stopped` is false while a running job has yet to reach its next
 * heartbeat (202).
 */
export async function stopScopedJob(
  token: string,
  scope: JobScopeRef,
  jobId: string,
): Promise<{ stopped: boolean; job: StaffJobDetail }> {
  const response = await sobaFetch(`${jobsPath(scope)}/${jobId}/cancel`, {
    token,
    method: 'POST',
  });
  const job = await parseJson<StaffJobDetail>(response);
  return { stopped: response.status === 200, job };
}
