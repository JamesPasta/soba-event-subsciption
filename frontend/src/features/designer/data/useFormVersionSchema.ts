'use client';

import { useCallback } from 'react';
import type { FormType } from '@formio/react';
import { getFormVersionSchema } from '@/src/shared/api/sobaApi';
import { useAuthedSWR } from '@/src/shared/api/useAuthedSWR';
import { sessionReadConfig } from '@/src/shared/api/swrConfig';
import { classifyDataError } from '@/src/shared/api/dataError';
import type { Resource } from '@/src/shared/api/dataContracts';

export const formVersionSchemaKey = (versionId: string) => ['form-version-schema', versionId];

/** The schema of one form version. A session read: it does not revalidate on its own. */
export function useFormVersionSchema(versionId: string | undefined): Resource<FormType> {
  const { data, isLoading, error, mutate } = useAuthedSWR<FormType | null>(
    versionId ? formVersionSchemaKey(versionId) : null,
    (token) => getFormVersionSchema(token, versionId as string),
    sessionReadConfig,
  );

  const refresh = useCallback(async () => {
    await mutate();
  }, [mutate]);

  return { data: data ?? null, isLoading, error: error ? classifyDataError(error) : null, refresh };
}
