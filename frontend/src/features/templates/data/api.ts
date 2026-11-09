import { sobaFetch } from '@/src/shared/api/sobaFetch';
import { ApiError, parseBlob, parseJson } from '@/src/shared/api/sobaHelpers';
import type { TemplateListResponse, TemplateResponse, TemplateType } from '@/src/types/templates';

const TEMPLATES_PATH = '/templates';
const templatePath = (templateId: string) => `${TEMPLATES_PATH}/${templateId}`;

const fileForm = (file: File, fields: Record<string, string> = {}): FormData => {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  form.set('file', file);
  return form;
};

/** The templates on the form's versions, newest version first. */
export async function listTemplates(token: string, formId: string): Promise<TemplateListResponse> {
  const response = await sobaFetch(TEMPLATES_PATH, { token, query: { formId } });
  return parseJson(response);
}

export async function uploadTemplate(
  token: string,
  formVersionId: string,
  type: TemplateType,
  name: string,
  file: File,
): Promise<TemplateResponse> {
  const response = await sobaFetch(TEMPLATES_PATH, {
    token,
    method: 'POST',
    query: { formVersionId },
    form: fileForm(file, name ? { type, name } : { type }),
  });
  return parseJson(response);
}

export async function replaceTemplateFile(
  token: string,
  templateId: string,
  file: File,
): Promise<TemplateResponse> {
  const response = await sobaFetch(`${templatePath(templateId)}/content`, {
    token,
    method: 'PUT',
    form: fileForm(file),
  });
  return parseJson(response);
}

export async function deleteTemplate(token: string, templateId: string): Promise<void> {
  const response = await sobaFetch(templatePath(templateId), { token, method: 'DELETE' });
  if (!response.ok) throw new ApiError(`Request failed (${response.status})`, response.status);
}

/** The template's file. The caller owns the blob. */
export async function downloadTemplate(token: string, templateId: string): Promise<Blob> {
  const response = await sobaFetch(`${templatePath(templateId)}/content`, { token });
  return parseBlob(response);
}
