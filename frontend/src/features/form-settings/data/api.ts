import { sobaFetch } from '@/src/shared/api/sobaFetch';
import { parseJson } from '@/src/shared/api/sobaHelpers';
import { EVENT_SUBSCRIPTION_SETTINGS_KEY } from '@/src/types/formSettings';

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

/** Fetches a saved event subscription token only when an editor asks to reveal it. */
export async function revealFormEventSubscriptionToken(
  token: string,
  formId: string,
): Promise<string> {
  const response = await sobaFetch(
    `${settingsPath(formId, EVENT_SUBSCRIPTION_SETTINGS_KEY)}/token`,
    {
      token,
      cache: 'no-store',
    },
  );
  const result = await parseJson<{ token: string }>(response);
  return result.token;
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
