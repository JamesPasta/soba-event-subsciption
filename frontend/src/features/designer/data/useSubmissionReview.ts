'use client';

import { useCallback } from 'react';
import { useSWRConfig } from 'swr';
import { ApiErrorCodes } from '@soba/lib';
import {
  addSobaSubmissionNote,
  getSobaSubmissionReview,
  getSobaSubmissionReviewers,
  updateSobaSubmissionStatus,
} from '@/src/shared/api/sobaApi';
import {
  canChangeReviewStatus,
  type SubmissionReview,
  type SubmissionReviewers,
  type SubmissionReviewStatus,
} from '@/src/types/submissionReview';
import { Permissions } from '@/src/types/permissions';
import { useAuthedSWR } from '@/src/shared/api/useAuthedSWR';
import { ApiError } from '@/src/shared/api/sobaHelpers';
import { classifyDataError } from '@/src/shared/api/dataError';
import type { Resource } from '@/src/shared/api/dataContracts';
import { hasPermission } from '@/src/shared/util/permissions';
import { useUnsavedId } from '@/src/shared/hooks/useUnsavedId';
import { designSubmissionKey } from './useDesignSubmission';
import { useDesignFormRead } from './useForm';

export const submissionReviewKey = (submissionId: string) => ['submission-review', submissionId];
export const submissionReviewersKey = (submissionId: string) => [
  'submission-reviewers',
  submissionId,
];

/** A status change the reviewer asks for; the hook adds which status it is made from. */
export interface StatusChange {
  status: SubmissionReviewStatus;
  assigneeId: string | null;
  /** Saved as a staff note with the change. */
  comment?: string;
  /** Puts the comment in the email the change sends. */
  attachCommentToEmail?: boolean;
}

const isStatusChanged = (error: unknown) =>
  error instanceof ApiError && error.code === ApiErrorCodes.status_changed;

/**
 * Staff review state of one submission: status, notes and edit history, with the writes the caller
 * may make. `canReview` says whether the caller holds submission_review on the form; it is false
 * until the form's permissions are known.
 */
export function useSubmissionReview(submissionId: string, formId: string) {
  const { data, error, isLoading, mutate } = useAuthedSWR(
    submissionReviewKey(submissionId),
    (token) => getSobaSubmissionReview(token, submissionId),
  );
  const { data: form } = useDesignFormRead(formId);
  const canReview = hasPermission(form?.permissions, Permissions.submission_review) === true;
  const current = data?.statusHistory[0];
  // The status controls show for reviewers when the status can change and there is one to move from.
  const canUpdateStatus =
    canReview &&
    current !== undefined &&
    canChangeReviewStatus(data?.allowStatusUpdates === true, current.status);

  const unsavedNote = useUnsavedId();
  const unsavedStatus = useUnsavedId();
  const { mutate: mutateKey } = useSWRConfig();

  // Each write answers with the updated review, which replaces the cached one.
  const addNote = useCallback(
    async (token: string, text: string) => {
      const id = unsavedNote.idFor(text);
      await mutate(addSobaSubmissionNote(token, submissionId, { id, text }), {
        revalidate: false,
      });
      unsavedNote.saved();
    },
    [mutate, submissionId, unsavedNote],
  );

  const updateStatus = useCallback(
    async (token: string, change: StatusChange) => {
      if (!current) throw new Error('A submission without a status cannot change status');
      const id = unsavedStatus.idFor(
        `${current.id}:${change.status}:${change.assigneeId}:${change.comment ?? ''}:${change.attachCommentToEmail === true}`,
      );
      // A status change can move the workflow state and the answers, which the submission read holds.
      const rereadSubmission = () => mutateKey(designSubmissionKey(submissionId));
      try {
        await mutate(
          updateSobaSubmissionStatus(token, submissionId, {
            id,
            fromStatusId: current.id,
            ...change,
          }),
          { revalidate: false },
        );
        unsavedStatus.saved();
        await rereadSubmission();
      } catch (e: unknown) {
        // Someone else changed the status first: show theirs, so the reviewer decides again.
        if (isStatusChanged(e)) await Promise.all([mutate(), rereadSubmission()]);
        throw e;
      }
    },
    [current, mutate, mutateKey, submissionId, unsavedStatus],
  );

  const refresh = useCallback(async () => {
    await mutate();
  }, [mutate]);
  const review: Resource<SubmissionReview> = {
    data: data ?? null,
    isLoading,
    error: error ? classifyDataError(error) : null,
    refresh,
  };

  return { review, canReview, canUpdateStatus, addNote, updateStatus };
}

/** Who a submission can be assigned to. Read only when `enabled`, as only reviewers may list them. */
export function useSubmissionReviewers(submissionId: string, enabled: boolean) {
  const { data, error, isLoading, mutate } = useAuthedSWR<SubmissionReviewers>(
    enabled ? submissionReviewersKey(submissionId) : null,
    (token) => getSobaSubmissionReviewers(token, submissionId),
  );
  const refresh = useCallback(async () => {
    await mutate();
  }, [mutate]);
  const reviewers: Resource<SubmissionReviewers> = {
    data: data ?? null,
    isLoading,
    error: error ? classifyDataError(error) : null,
    refresh,
  };
  return reviewers;
}
