// Submit-mode API service: submission open/save/submit, reads of an existing submission, and the
// caller's own lists and delete. All calls hit /submit/*. The token is optional except on the lists
// and delete; the backend attributes anonymous callers to the seeded public user. Opening needs a
// submit role on the form or its audience; reading an existing submission needs participation in
// it, and writing it needs both.
import { sobaFetch } from './sobaFetch';
import { parseJson } from './sobaHelpers';
import { sortLocaleHeaders, sortLocaleRequest } from './sortLocaleRequest';
import { toListRequestQuery, type ListQueryArgs } from '@/src/types/list';
import { FormType } from '@formio/react';
import type { SortLocale } from '@soba/lib/sort';
import type {
  ListMyFormsResponse,
  SubmitFillBundle,
  SubmitFormVersionSchemaResponse,
  SubmissionDataDocument,
  SubmitterForm,
} from '../../types/forms';
import type { MyWorkspaceLookupResponse } from '../../types/workspaces';
import type {
  SubmissionDataBody,
  SubmissionResponse,
  SubmissionWriteResponse,
  SubmitSubmissionBody,
  SubmitSubmissionResponse,
  ListMySubmissionsResponse,
  MySubmissionState,
  ReviseSubmissionBody,
} from '@/src/types/submissions';

/**
 * The one payload the fill page needs: workflow state, form version, head revision, schema, any
 * saved answers (resume) and whether the caller may write and save a draft.
 */
export async function getSubmitFillBundle(
  token: string | undefined,
  submissionId: string,
): Promise<SubmitFillBundle> {
  const response = await sobaFetch(`/submit/submissions/${submissionId}/fill`, { token });
  return parseJson<SubmitFillBundle>(response);
}

/** A form the caller may start a submission on, with its facts; refused as an open would be. */
export async function getSubmitForm(
  token: string | undefined,
  formId: string,
): Promise<SubmitterForm> {
  const response = await sobaFetch(`/submit/forms/${formId}`, { token });
  return parseJson<SubmitterForm>(response);
}

/** The published version's schema, with its hash, to render a new submission before it is opened. */
export async function getSubmitFormVersionSchema(
  token: string | undefined,
  formVersionId: string,
): Promise<SubmitFormVersionSchemaResponse> {
  const response = await sobaFetch(`/submit/form-versions/${formVersionId}/schema`, { token });
  return parseJson<SubmitFormVersionSchemaResponse>(response);
}

/** A submission's own form-version schema, for its read-only confirmation view. */
export async function getSubmitSubmissionSchema(
  token: string | undefined,
  submissionId: string,
): Promise<FormType | null> {
  const response = await sobaFetch(`/submit/submissions/${submissionId}/schema`, { token });
  if (response.status === 404) return null;
  return parseJson(response);
}

/**
 * Open a SOBA submission (a PG row in the `opened` state) under a client-minted id (uuidv7); its
 * answer data is written later via saveSobaFormSubmission (draft) or submitSobaFormSubmission (submit).
 * The create is idempotent on the id, so a retry with the same id returns the same record. A
 * formVersionId must be the published version (409 otherwise). Token is optional: anonymous
 * submissions to a public-audience form are attributed to the public user.
 */
export async function openSobaFormSubmission(
  token: string | undefined,
  formId: string,
  id: string,
  formVersionId?: string,
): Promise<SubmissionResponse> {
  const response = await sobaFetch('/submit/submissions', {
    token,
    method: 'POST',
    json: { id, formId, formVersionId },
  });
  return parseJson<SubmissionResponse>(response);
}

/**
 * Save a submission's answer data as a draft, without engine validation; the server writes a new
 * engine document + revision. `revision.status` reports whether the save became current or was held
 * as pending.
 */
export async function saveSobaFormSubmission(
  token: string | undefined,
  submissionId: string,
  body: SubmissionDataBody,
): Promise<SubmissionWriteResponse> {
  const response = await sobaFetch(`/submit/submissions/${submissionId}/save`, {
    token,
    method: 'POST',
    json: body,
  });
  return parseJson<SubmissionWriteResponse>(response);
}

/**
 * Submit a submission's answer data. `revision.status` is `current` when the submit landed, or
 * `pending` when it was held for review (a conflict, or a submit against an already-submitted
 * record). A retry with the same revisionId replays the recorded revision.
 */
export async function submitSobaFormSubmission(
  token: string | undefined,
  submissionId: string,
  body: SubmitSubmissionBody,
): Promise<SubmissionWriteResponse> {
  const response = await sobaFetch(`/submit/submissions/${submissionId}/submit`, {
    token,
    method: 'POST',
    json: body,
  });
  return parseJson<SubmissionWriteResponse>(response);
}

/** One page of the caller's own draft and submitted submissions; signed-in callers only. */
export async function getMySubmissions(
  token: string,
  args: ListQueryArgs & { workflowState?: MySubmissionState },
): Promise<ListMySubmissionsResponse> {
  const response = await sobaFetch('/submit/submissions/mine', {
    token,
    query: { ...toListRequestQuery(args), workflowState: args.workflowState },
    headers: sortLocaleHeaders(args.locale),
  });
  return parseJson(response);
}

/** A page of the forms the caller holds a submit role on or has submitted to; signed in. */
export async function getMyForms(
  token: string,
  args: ListQueryArgs & { workspaceId?: string },
): Promise<ListMyFormsResponse> {
  const response = await sobaFetch('/submit/forms/mine', {
    token,
    query: { ...toListRequestQuery(args), workspaceId: args.workspaceId },
    headers: sortLocaleHeaders(args.locale),
  });
  return parseJson(response);
}

/** The workspaces the caller's forms belong to, for a filter; signed-in callers only. */
export async function getMyWorkspaces(
  token: string,
  locale?: SortLocale,
): Promise<MyWorkspaceLookupResponse> {
  const response = await sobaFetch('/submit/workspaces/mine', {
    token,
    ...sortLocaleRequest(locale),
  });
  return parseJson(response);
}

/** Delete the caller's own unsubmitted submission. A 404 counts as deleted. */
export async function deleteSubmitSubmission(token: string, submissionId: string): Promise<void> {
  const response = await sobaFetch(`/submit/submissions/${submissionId}`, {
    token,
    method: 'DELETE',
  });
  if (!response.ok && response.status !== 404) await parseJson(response);
}

/** The owner sends their own submitted submission back to revise; a retry of `body.id` answers the same. */
export async function reviseSubmitSubmission(
  token: string,
  submissionId: string,
  body: ReviseSubmissionBody,
): Promise<SubmissionResponse> {
  const response = await sobaFetch(`/submit/submissions/${submissionId}/revise`, {
    token,
    method: 'POST',
    json: body,
  });
  return parseJson<SubmissionResponse>(response);
}

/** Read a submission's metadata for the confirmation view. */
export async function getSubmitSubmission(
  token: string | undefined,
  id: string,
): Promise<SubmitSubmissionResponse> {
  const response = await sobaFetch(`/submit/submissions/${id}`, { token });
  return parseJson(response);
}

/** Read a submission's answer document for the confirmation view (null if not yet provisioned). */
export async function getSubmitSubmissionData(
  token: string | undefined,
  submissionId: string,
): Promise<SubmissionDataDocument | null> {
  const response = await sobaFetch(`/submit/submissions/${submissionId}/data`, { token });
  if (response.status === 404) return null;
  return parseJson<SubmissionDataDocument>(response);
}
