import {
  API_KEY_SETTINGS_KEY,
  CredentialMetadataSchema,
  CredentialSecretSchema,
  CredentialStateSchema,
} from '@soba/lib';
import type {
  CredentialFields,
  CredentialMetadata,
  CredentialOwner,
  CredentialSecret,
  CredentialState,
} from '@/src/types/credentials';
import { sobaFetch } from '@/src/shared/api/sobaFetch';
import { parseJson } from '@/src/shared/api/sobaHelpers';
import { toListRequestQuery, type ListQueryArgs } from '@/src/types/list';
import { sortLocaleHeaders } from '@/src/shared/api/sortLocaleRequest';

const keysPath = (owner: CredentialOwner) =>
  owner.kind === 'workspace'
    ? `/workspaces/${encodeURIComponent(owner.id)}/settings/${API_KEY_SETTINGS_KEY}`
    : `/design/forms/${encodeURIComponent(owner.id)}/settings/${API_KEY_SETTINGS_KEY}`;
const keyPath = (owner: CredentialOwner, credentialId: string) =>
  `${keysPath(owner)}/${encodeURIComponent(credentialId)}`;

export const listCredentials = async (
  token: string,
  owner: CredentialOwner,
  query: ListQueryArgs,
): Promise<CredentialState> =>
  CredentialStateSchema.parse(
    await parseJson<unknown>(
      await sobaFetch(keysPath(owner), {
        token,
        query: toListRequestQuery(query),
        headers: sortLocaleHeaders(query.locale),
      }),
    ),
  );

export const getCredential = async (
  token: string,
  owner: CredentialOwner,
  credentialId: string,
): Promise<CredentialMetadata> =>
  CredentialMetadataSchema.parse(
    await parseJson<unknown>(await sobaFetch(keyPath(owner, credentialId), { token })),
  );

export const issueCredential = async (
  token: string,
  owner: CredentialOwner,
  fields: CredentialFields,
): Promise<CredentialSecret> =>
  CredentialSecretSchema.parse(
    await parseJson<unknown>(
      await sobaFetch(keysPath(owner), { token, method: 'POST', json: fields }),
    ),
  );

export const updateCredential = async (
  token: string,
  owner: CredentialOwner,
  credentialId: string,
  fields: CredentialFields,
): Promise<CredentialMetadata> =>
  CredentialMetadataSchema.parse(
    await parseJson<unknown>(
      await sobaFetch(keyPath(owner, credentialId), { token, method: 'PATCH', json: fields }),
    ),
  );

export const regenerateCredential = async (
  token: string,
  owner: CredentialOwner,
  credentialId: string,
): Promise<CredentialSecret> =>
  CredentialSecretSchema.parse(
    await parseJson<unknown>(
      await sobaFetch(`${keyPath(owner, credentialId)}/regenerate`, {
        token,
        method: 'POST',
        json: {},
      }),
    ),
  );

export const deleteCredential = async (
  token: string,
  owner: CredentialOwner,
  credentialId: string,
): Promise<void> => {
  const response = await sobaFetch(keyPath(owner, credentialId), { token, method: 'DELETE' });
  if (!response.ok) await parseJson(response);
};
