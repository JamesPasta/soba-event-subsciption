// Design-mode API service: form authoring + submission management. All calls hit /design/* and
// require a staff token. Submit-mode calls live in sobaApiSubmit.
import { sobaFetch } from './sobaFetch';
import { parseDownload, parseJson, type DownloadedFile } from './sobaHelpers';
import { FormType } from '@formio/react';
import type {
  SobaFormType,
  CreateFormFields,
  CreateSobaFormioFormResponse,
  SobaResponseFormType,
  SobaFormDetail,
  SobaFormVersionType,
  ListFormsResponse,
  ListFormVersionsResponse,
  FormVersionLookupResponse,
  SubmissionDataDocument,
} from '../../types/forms';
import type {
  ListSubmissionsResponse,
  SubmissionDataBody,
  SubmissionResponse,
} from '@/src/types/submissions';
import {
  SUBMISSION_DATA_SUBPATH,
  SubmissionReviewSubpaths,
  type AddSubmissionNoteBody,
  type SubmissionReview,
  type SubmissionReviewers,
  type SubmissionReviewStatus,
  type UpdateSubmissionStatusBody,
} from '@/src/types/submissionReview';
import type {
  StartSubmissionExportBody,
  SubmissionExport,
  SubmissionExportFieldsBody,
  SubmissionExportFieldsResponse,
  SubmissionExportList,
} from '@/src/types/submissionExport';
import { toListRequestQuery, type ListQueryArgs } from '@/src/types/list';
import { sortLocaleHeaders } from './sortLocaleRequest';

/** What a create returned; `created` is false when a retry got back what an earlier attempt made. */
export interface CreateResult<T> {
  value: T;
  created: boolean;
}

const createResult = async <T>(response: Response): Promise<CreateResult<T>> => ({
  value: await parseJson<T>(response),
  created: response.status === 201,
});

export async function createSobaFormioForm(
  token: string,
  data: CreateFormFields,
  workspaceId?: string,
): Promise<CreateResult<CreateSobaFormioFormResponse>> {
  const response = await sobaFetch('/design/forms', {
    token,
    method: 'POST',
    json: { ...data, formEngineCode: 'formio-v5', workspaceId },
  });
  return createResult(response);
}

export async function updateSobaForm(
  token: string,
  id: string,
  data: Partial<SobaFormType>,
): Promise<SobaResponseFormType> {
  const response = await sobaFetch(`/design/forms/${id}`, {
    token,
    method: 'PATCH',
    json: data,
  });
  return parseJson(response);
}

export async function publishSobaFormVersion(token: string, id: string) {
  const response = await sobaFetch(`/design/form-versions/${id}/publish`, {
    token,
    method: 'POST',
  });
  return parseJson(response);
}

export async function getSobaForm(token: string, id: string): Promise<SobaFormDetail> {
  const response = await sobaFetch(`/design/forms/${id}`, { token });
  return parseJson(response);
}

/** One page of forms. Search, sort and paging are resolved by the server. */
export async function getSobaForms(
  token: string,
  args: ListQueryArgs & { workspaceId?: string },
): Promise<ListFormsResponse> {
  const response = await sobaFetch('/design/forms', {
    token,
    query: { ...toListRequestQuery(args), workspaceId: args.workspaceId },
    headers: sortLocaleHeaders(args.locale),
  });
  return parseJson(response);
}

/** One page of submissions. Search, sort and paging are resolved by the server. */
export async function getSobaSubmissions(
  token: string,
  args: ListQueryArgs & {
    formId?: string;
    workspaceId?: string;
    workflowState?: string;
    reviewStatus?: SubmissionReviewStatus;
    assigneeId?: string;
  },
): Promise<ListSubmissionsResponse> {
  const response = await sobaFetch('/design/submissions', {
    token,
    query: {
      ...toListRequestQuery(args),
      formId: args.formId,
      workspaceId: args.workspaceId,
      workflowState: args.workflowState,
      reviewStatus: args.reviewStatus,
      assigneeId: args.assigneeId,
    },
    headers: sortLocaleHeaders(args.locale),
  });
  return parseJson(response);
}

/** Staff read of a single submission's metadata (management/review). */
export async function getSobaSubmission(token: string, id: string): Promise<SubmissionResponse> {
  const response = await sobaFetch(`/design/submissions/${id}`, { token });
  return parseJson(response);
}

/** Staff read of a submission's answer document (null if not yet provisioned). */
export async function getSobaSubmissionData(
  token: string,
  submissionId: string,
): Promise<SubmissionDataDocument | null> {
  const response = await sobaFetch(
    `/design/submissions/${submissionId}${SUBMISSION_DATA_SUBPATH}`,
    {
      token,
    },
  );
  if (response.status === 404) return null;
  return parseJson<SubmissionDataDocument>(response);
}

/**
 * Staff change a submitted submission's answers, based on the revision they loaded. A retry of
 * `body.revisionId` answers the same.
 */
export async function updateSobaSubmissionData(
  token: string,
  submissionId: string,
  body: SubmissionDataBody,
): Promise<SubmissionResponse> {
  const response = await sobaFetch(
    `/design/submissions/${submissionId}${SUBMISSION_DATA_SUBPATH}`,
    {
      token,
      method: 'PUT',
      json: body,
    },
  );
  return parseJson<SubmissionResponse>(response);
}

const reviewPath = (submissionId: string) => `/design/submissions/${submissionId}/review`;

/** Status history, staff notes and edit history of a submission, each newest first. */
export async function getSobaSubmissionReview(
  token: string,
  submissionId: string,
): Promise<SubmissionReview> {
  const response = await sobaFetch(reviewPath(submissionId), { token });
  return parseJson(response);
}

/** Adds a staff note under the id the caller chose; a retry with the same id adds it once. */
export async function addSobaSubmissionNote(
  token: string,
  submissionId: string,
  body: AddSubmissionNoteBody,
): Promise<SubmissionReview> {
  const response = await sobaFetch(`${reviewPath(submissionId)}${SubmissionReviewSubpaths.notes}`, {
    token,
    method: 'POST',
    json: body,
  });
  return parseJson(response);
}

/**
 * Moves a submission to a new status, from the status the caller saw, under the id the caller
 * chose; a retry with the same id makes the change once.
 */
export async function updateSobaSubmissionStatus(
  token: string,
  submissionId: string,
  body: UpdateSubmissionStatusBody,
): Promise<SubmissionReview> {
  const response = await sobaFetch(
    `${reviewPath(submissionId)}${SubmissionReviewSubpaths.status}`,
    {
      token,
      method: 'POST',
      json: body,
    },
  );
  return parseJson(response);
}

/** Who a submission can be assigned to: everyone holding submission_review on its form. */
export async function getSobaSubmissionReviewers(
  token: string,
  submissionId: string,
): Promise<SubmissionReviewers> {
  const response = await sobaFetch(
    `${reviewPath(submissionId)}${SubmissionReviewSubpaths.reviewers}`,
    { token },
  );
  return parseJson(response);
}

const FORM_VERSIONS_PATH = '/design/form-versions';

/** One form's versions for a select, newest first. */
export async function lookupFormVersions(
  token: string,
  formId: string,
): Promise<FormVersionLookupResponse> {
  const response = await sobaFetch(`${FORM_VERSIONS_PATH}/lookup`, { token, query: { formId } });
  return parseJson(response);
}

/** One version, by id. */
export async function getSobaFormVersion(token: string, id: string): Promise<SobaFormVersionType> {
  const response = await sobaFetch(`${FORM_VERSIONS_PATH}/${id}`, { token });
  return parseJson(response);
}

/** One page of a form's versions, for the history table. */
export async function getSobaFormVersionPage(
  token: string,
  args: ListQueryArgs & { formId: string },
): Promise<ListFormVersionsResponse> {
  const response = await sobaFetch(FORM_VERSIONS_PATH, {
    token,
    query: { formId: args.formId, ...toListRequestQuery(args) },
  });
  return parseJson(response);
}

/**
 * Create a form version draft with its schema in one request. `fromFormVersionId`: the version whose
 * document templates the draft gets, and whose schema it starts from when none is sent. A retry with
 * the same `id` returns the draft the first request made.
 */
export async function createFormVersion(
  token: string,
  draft: { id: string; formId: string; fromFormVersionId?: string; schema?: FormType },
): Promise<CreateResult<SobaFormVersionType>> {
  const response = await sobaFetch(FORM_VERSIONS_PATH, { token, method: 'POST', json: draft });
  return createResult(response);
}

/** Save a form version's schema; the server provisions it in the engine (Form.io). */
export async function saveFormVersionSchema(
  token: string,
  id: string,
  schema: FormType,
): Promise<SobaFormVersionType> {
  const response = await sobaFetch(`/design/form-versions/${id}/schema`, {
    token,
    method: 'POST',
    json: { schema },
  });
  return parseJson(response);
}

/** Read a form version's schema back from the engine (null if not yet provisioned). */
export async function getFormVersionSchema(token: string, id: string): Promise<FormType | null> {
  const response = await sobaFetch(`/design/form-versions/${id}/schema`, { token });
  if (response.status === 404) return null;
  return parseJson(response);
}

/**
 * A 404 means the submission was already gone, which is the outcome the caller asked for. Reporting
 * it as a failure would contradict the refreshed list.
 */
export async function deleteSobaSubmission(token: string, id: string): Promise<void> {
  const response = await sobaFetch(`/design/submissions/${id}`, { token, method: 'DELETE' });
  if (!response.ok && response.status !== 404) await parseJson(response);
}

/** A submission's file, for staff. */
export async function downloadSobaSubmissionFile(
  token: string,
  submissionId: string,
  fileId: string,
): Promise<DownloadedFile> {
  const response = await sobaFetch(`/design/submissions/${submissionId}/files/${fileId}`, {
    token,
  });
  return parseDownload(response);
}

/** The fields an export with these filters can include. */
export async function getSobaExportFields(
  token: string,
  formId: string,
  filters: SubmissionExportFieldsBody,
): Promise<SubmissionExportFieldsResponse> {
  const response = await sobaFetch(`/design/forms/${formId}/exports/fields`, {
    token,
    method: 'POST',
    json: filters,
  });
  return parseJson(response);
}

/** Start an export; answers with the queued export. */
export async function startSobaSubmissionExport(
  token: string,
  formId: string,
  body: StartSubmissionExportBody,
): Promise<SubmissionExport> {
  const response = await sobaFetch(`/design/forms/${formId}/exports`, {
    token,
    method: 'POST',
    json: body,
  });
  return parseJson(response);
}

/** One page of the caller's exports of a form. */
export async function listSobaSubmissionExports(
  token: string,
  formId: string,
  args: ListQueryArgs,
): Promise<SubmissionExportList> {
  const response = await sobaFetch(`/design/forms/${formId}/exports`, {
    token,
    query: toListRequestQuery(args),
  });
  return parseJson(response);
}

/**
 * Stop one of the caller's exports. `stopped` is false while a running export has yet to stop; a
 * finished export answers 409.
 */
export async function stopSobaSubmissionExport(
  token: string,
  formId: string,
  exportId: string,
): Promise<{ stopped: boolean; export: SubmissionExport }> {
  const response = await sobaFetch(`/design/forms/${formId}/exports/${exportId}/cancel`, {
    token,
    method: 'POST',
  });
  const item = await parseJson<SubmissionExport>(response);
  return { stopped: response.status === 200, export: item };
}

/** A ready export's file. */
export async function downloadSobaSubmissionExport(
  token: string,
  formId: string,
  exportId: string,
): Promise<DownloadedFile> {
  const response = await sobaFetch(`/design/forms/${formId}/exports/${exportId}/file`, { token });
  return parseDownload(response);
}
