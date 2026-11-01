'use client';

import { useCallback } from 'react';
import { useSWRConfig } from 'swr';
import { API_KEY_SETTINGS_KEY } from '@soba/lib';
import type { WriteOutcome } from '@/src/shared/api/dataContracts';
import type {
  CredentialFields,
  CredentialMetadata,
  CredentialOwner,
  CredentialSecret,
} from '@/src/types/credentials';
import {
  deleteCredential,
  getCredential,
  issueCredential,
  regenerateCredential,
  updateCredential,
} from './api';

const sameFields = (record: CredentialMetadata, fields: CredentialFields) =>
  record.label === fields.label &&
  record.notes === fields.notes &&
  record.types.length === fields.types.length &&
  record.types.every((type) => fields.types.includes(type));

/**
 * Generate, edit, regenerate or delete the owner's keys. Every write re-reads the key lists, also
 * after a failure, since a failed generate can leave a key behind. A returned key goes straight to
 * the caller, without waiting for that re-read: a slow list must not keep the key off the screen.
 */
export function useCredentialWriter(owner: CredentialOwner) {
  const { mutate } = useSWRConfig();
  const { kind, id } = owner;
  const refresh = useCallback(
    () =>
      mutate((key) => Array.isArray(key) && key[0] === API_KEY_SETTINGS_KEY).catch(() => undefined),
    [mutate],
  );

  const afterWrite = useCallback(
    async <T>(write: () => Promise<T>): Promise<WriteOutcome<T>> => {
      try {
        return { status: 'applied', value: await write() };
      } finally {
        await refresh();
      }
    },
    [refresh],
  );

  const afterIssue = useCallback(
    async (write: () => Promise<CredentialSecret>): Promise<WriteOutcome<CredentialSecret>> => {
      try {
        return { status: 'applied', value: await write() };
      } finally {
        void refresh();
      }
    },
    [refresh],
  );

  const generate = useCallback(
    (token: string, fields: CredentialFields): Promise<WriteOutcome<CredentialSecret>> =>
      afterIssue(() => issueCredential(token, { kind, id }, fields)),
    [afterIssue, kind, id],
  );

  /** Sends nothing when the fields still match `record`, the key as the form last saved it. */
  const update = useCallback(
    (
      token: string,
      record: CredentialMetadata,
      fields: CredentialFields,
    ): Promise<WriteOutcome<CredentialMetadata>> => {
      if (sameFields(record, fields)) return Promise.resolve({ status: 'applied', value: record });
      return afterWrite(() => updateCredential(token, { kind, id }, record.id, fields));
    },
    [afterWrite, kind, id],
  );

  const regenerate = useCallback(
    (token: string, credentialId: string): Promise<WriteOutcome<CredentialSecret>> =>
      afterIssue(() => regenerateCredential(token, { kind, id }, credentialId)),
    [afterIssue, kind, id],
  );

  /** The key as the server holds it now, for a caller whose write failed. Not cached. */
  const reread = useCallback(
    (token: string, credentialId: string): Promise<CredentialMetadata> =>
      getCredential(token, { kind, id }, credentialId),
    [kind, id],
  );

  const remove = useCallback(
    (token: string, credentialId: string): Promise<WriteOutcome<void>> =>
      afterWrite(() => deleteCredential(token, { kind, id }, credentialId)),
    [afterWrite, kind, id],
  );

  return { generate, update, regenerate, reread, remove };
}
