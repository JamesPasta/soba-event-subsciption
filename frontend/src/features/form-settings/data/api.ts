import { sobaFetch } from '@/src/shared/api/sobaFetch';
import { parseJson } from '@/src/shared/api/sobaHelpers';

const settingsPath = (formId: string, key: string) => `/design/forms/${formId}/settings/${key}`;

/** A settings group of a form. */
export async function getFormSettings<TSettings>(
  token: string,
  formId: string,
  key: string,
): Promise<TSettings> {
  const response = await sobaFetch(settingsPath(formId, key), { token });
  return parseJson(response);
}

/** Saves a settings group of a form; resolves to the saved settings. */
export async function setFormSettings<TBody, TSettings>(
  token: string,
  formId: string,
  key: string,
  body: TBody,
): Promise<TSettings> {
  const response = await sobaFetch(settingsPath(formId, key), {
    token,
    method: 'PUT',
    json: body,
  });
  return parseJson(response);
}

const workspaceSettingsPath = (workspaceId: string, key: string) =>
  `/workspaces/${workspaceId}/settings/${key}`;

/** A settings group of a workspace, shared by its forms. */
export async function getWorkspaceSettings<TSettings>(
  token: string,
  workspaceId: string,
  key: string,
): Promise<TSettings> {
  const response = await sobaFetch(workspaceSettingsPath(workspaceId, key), { token });
  return parseJson(response);
}

/** Saves a settings group of a workspace; resolves to the saved settings. */
export async function setWorkspaceSettings<TSettings>(
  token: string,
  workspaceId: string,
  key: string,
  body: TSettings,
): Promise<TSettings> {
  const response = await sobaFetch(workspaceSettingsPath(workspaceId, key), {
    token,
    method: 'PUT',
    json: body,
  });
  return parseJson(response);
}

/** How many live forms in a workspace use a group's workspace values rather than their own. */
export async function getWorkspaceInheritingForms(
  token: string,
  workspaceId: string,
  key: string,
): Promise<{ count: number }> {
  const response = await sobaFetch(`${workspaceSettingsPath(workspaceId, key)}/inheriting-forms`, {
    token,
  });
  return parseJson(response);
}
