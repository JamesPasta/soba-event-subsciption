'use client';

import { getSubmitFillBundle } from '@/src/shared/api/sobaApi';
import type { Resource } from '@/src/shared/api/dataContracts';
import type { SubmitFillBundle } from '@/src/types/forms';
import type { FillSession } from './useFillSession';
import { useFillRead } from './useFillRead';

/**
 * The bundle for filling one submission: workflow state, its version schema, any saved answers, the
 * caller's role and the form's facts. Works signed in or anonymously, as the page's session.
 */
export function useSubmitFill(
  submissionId: string,
  session: FillSession,
): Resource<SubmitFillBundle> {
  return useFillRead(submissionId ? ['submit-fill', submissionId] : null, session, (token) =>
    getSubmitFillBundle(token, submissionId),
  );
}
