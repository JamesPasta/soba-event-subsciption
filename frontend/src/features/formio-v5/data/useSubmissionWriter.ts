'use client';

import { useCallback, useRef } from 'react';
import { v7 as uuidv7 } from 'uuid';
import {
  getSubmitFillBundle,
  saveSobaFormSubmission,
  submitSobaFormSubmission,
} from '@/src/shared/api/sobaApi';
import { ApiError } from '@/src/shared/api/sobaHelpers';
import { useCallToken } from '@/src/shared/api/callToken';
import type { WriteOutcome } from '@/src/shared/api/dataContracts';
import type { SubmitFillBundle } from '@/src/types/forms';
import { SubmissionWorkflowState, type SubmissionWriteResponse } from '@/src/types/submissions';

type WriteKind = 'save' | 'submit';

/**
 * The writes of one fill session, sent as the session started: a signed-in session never writes
 * anonymously. Mints a revision id per answers, one slot for saves and one for submits, and reuses it
 * only when the last attempt of that kind got no response or a server failure, so a retry replays
 * rather than forks. Maps a pending revision to a held outcome carrying its reason (`conflict`, or
 * `closed` for an already-submitted record).
 */
export function useSubmissionWriter(submissionId: string, signedIn: boolean) {
  const { tokenFor } = useCallToken();
  const pendingRevisionsRef = useRef<
    Partial<Record<WriteKind, { revisionId: string; key: string }>>
  >({});

  const revisionIdFor = useCallback((kind: WriteKind, data: Record<string, unknown>) => {
    const key = JSON.stringify(data);
    const pending = pendingRevisionsRef.current[kind];
    if (pending?.key === key) return pending.revisionId;
    const revisionId = uuidv7();
    pendingRevisionsRef.current[kind] = { revisionId, key };
    return revisionId;
  }, []);

  // A success or a refusal settles the id: a success must not be replayed and a refusal recorded
  // nothing. No response or a server failure keeps it, since the write may have landed and a retry
  // must replay it rather than fork.
  const send = useCallback(
    async (
      kind: WriteKind,
      data: Record<string, unknown>,
      baseRevisionId: string,
    ): Promise<SubmissionWriteResponse> => {
      const token = tokenFor(signedIn);
      const body = { data, revisionId: revisionIdFor(kind, data), baseRevisionId };
      try {
        const write = kind === 'save' ? saveSobaFormSubmission : submitSobaFormSubmission;
        const value = await write(token, submissionId, body);
        pendingRevisionsRef.current[kind] = undefined;
        return value;
      } catch (err) {
        if (err instanceof ApiError && err.status < 500)
          pendingRevisionsRef.current[kind] = undefined;
        throw err;
      }
    },
    [submissionId, signedIn, tokenFor, revisionIdFor],
  );

  const toOutcome = (value: SubmissionWriteResponse): WriteOutcome<SubmissionWriteResponse> =>
    value.revision.status === 'pending'
      ? { status: 'held', reason: value.revision.reason }
      : { status: 'applied', value };

  const save = useCallback(
    async (data: Record<string, unknown>, baseRevisionId: string) => {
      const value = await send('save', data, baseRevisionId);
      const outcome = toOutcome(value);
      if (outcome.status !== 'applied') return outcome;
      // A replayed save reports where it first landed; the record may have been submitted, or saved
      // again elsewhere, since.
      if (value.workflowState === SubmissionWorkflowState.submitted)
        return { status: 'held', reason: 'closed' } as const;
      if (value.headRevisionId !== value.revision.id) {
        return { status: 'held', reason: 'conflict' } as const;
      }
      return outcome;
    },
    [send],
  );

  const submit = useCallback(
    async (data: Record<string, unknown>, baseRevisionId: string) =>
      toOutcome(await send('submit', data, baseRevisionId)),
    [send],
  );

  // Re-read the head after a held write, so the caller can write over it or, if the record is now
  // submitted, leave for the confirmation.
  const reloadHead = useCallback(
    async (): Promise<SubmitFillBundle> => getSubmitFillBundle(tokenFor(signedIn), submissionId),
    [submissionId, signedIn, tokenFor],
  );

  return { save, submit, reloadHead };
}
