'use client';

import { useCallback } from 'react';
import {
  getFormVersionSchema,
  getSobaSubmission,
  getSobaSubmissionData,
} from '@/src/shared/api/sobaApi';
import { useAuthedSWR } from '@/src/shared/api/useAuthedSWR';
import { classifyDataError } from '@/src/shared/api/dataError';
import type { DataError, Resource } from '@/src/shared/api/dataContracts';

type DesignSubmission = Awaited<ReturnType<typeof loadDesignSubmission>>;

export const designSubmissionKey = (submissionId: string) => ['design-submission', submissionId];

async function loadDesignSubmission(token: string, submissionId: string) {
  const submission = await getSobaSubmission(token, submissionId);
  const [schema, content] = await Promise.all([
    getFormVersionSchema(token, submission.formVersionId),
    getSobaSubmissionData(token, submissionId),
  ]);
  return { submission, schema, content };
}

/** Staff view of one submission: the record, its version schema, and the answers. */
export function useDesignSubmission(
  submissionId: string,
  formId: string,
): Resource<DesignSubmission> {
  const { data, error, isLoading, mutate } = useAuthedSWR(
    submissionId ? designSubmissionKey(submissionId) : null,
    (token) => loadDesignSubmission(token, submissionId),
  );

  // The URL names the form; a submission from another form is not found under it.
  const mismatch = !!data && data.submission.formId !== formId;
  let classified: DataError | null = null;
  if (mismatch) classified = { kind: 'notFound', cause: null };
  else if (error) classified = classifyDataError(error);

  const refresh = useCallback(async () => {
    await mutate();
  }, [mutate]);

  return { data: mismatch ? null : (data ?? null), isLoading, error: classified, refresh };
}
