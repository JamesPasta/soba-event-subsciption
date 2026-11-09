import { sobaFetch } from '@/src/shared/api/sobaFetch';
import { parseBlob, parseJson } from '@/src/shared/api/sobaHelpers';
import type { PrintOptions, StaffPrintFacts, SubmissionPrintFacts } from '@/src/types/templates';

/** Which API a print goes through: the submitter's, or the staff design surface. */
export type PrintSurface = 'submit' | 'design';

const submissionPath = (surface: PrintSurface, submissionId: string) =>
  `/${surface}/submissions/${submissionId}`;

/** The submission's stored template and whether it can render, signed in or not. */
export async function getSubmitterPrintFacts(
  token: string | undefined,
  submissionId: string,
): Promise<SubmissionPrintFacts> {
  const response = await sobaFetch(`${submissionPath('submit', submissionId)}/templates`, {
    token,
  });
  return parseJson(response);
}

/** The submission's stored templates and whether they can render, for staff. */
export async function getStaffPrintFacts(
  token: string,
  submissionId: string,
): Promise<StaffPrintFacts> {
  const response = await sobaFetch(`${submissionPath('design', submissionId)}/templates`, {
    token,
  });
  return parseJson(response);
}

/** The submission rendered with a template already on its form version. */
export async function printWithStoredTemplate(
  surface: PrintSurface,
  token: string | undefined,
  submissionId: string,
  templateId: string,
  options: PrintOptions,
): Promise<Blob> {
  const response = await sobaFetch(`${submissionPath(surface, submissionId)}/print`, {
    token,
    method: 'POST',
    json: { templateId, options },
  });
  return parseBlob(response);
}

/** The submission rendered with a template sent along with the request; nothing is stored. */
export async function printWithUploadedTemplate(
  token: string,
  submissionId: string,
  file: File,
  options: PrintOptions,
): Promise<Blob> {
  const form = new FormData();
  if (options.convertTo) form.set('convertTo', options.convertTo);
  if (options.reportName) form.set('reportName', options.reportName);
  form.set('file', file);
  const response = await sobaFetch(`/design/print-upload/${submissionId}`, {
    token,
    method: 'POST',
    form,
  });
  return parseBlob(response);
}
