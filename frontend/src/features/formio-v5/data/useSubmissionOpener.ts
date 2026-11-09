'use client';

import { useCallback, useRef } from 'react';
import { ApiErrorCodes } from '@soba/lib';
import {
  getSubmitForm,
  getSubmitFormVersionSchema,
  openSobaFormSubmission,
} from '@/src/shared/api/sobaApi';
import { ApiError } from '@/src/shared/api/sobaHelpers';
import { useCallToken } from '@/src/shared/api/callToken';
import type { SubmitFormVersionSchemaResponse, SubmitterForm } from '@/src/types/forms';
import type { SubmissionResponse } from '@/src/types/submissions';

/** The version a new submission was rendered from, as the schema read gave it. */
export interface RenderedVersion {
  formVersionId: string;
  schemaHash: string;
}

/**
 * The form was published again with a schema that renders differently from the one filled in.
 * Carries the new version and the form's facts as read with it.
 */
export class FormUpdatedError extends Error {
  constructor(
    readonly version: SubmitFormVersionSchemaResponse,
    readonly form: SubmitterForm,
  ) {
    super('The form was updated after it was opened');
    this.name = 'FormUpdatedError';
  }
}

export const isFormUpdated = (err: unknown): err is FormUpdatedError =>
  err instanceof FormUpdatedError;

const isVersionReplaced = (err: unknown) =>
  err instanceof ApiError && err.code === ApiErrorCodes.version_not_published;

/** The head the first write is based on: the revision the open recorded. */
const headOf = (opened: SubmissionResponse): string => {
  if (!opened.headRevisionId) throw new Error('The opened submission has no head revision');
  return opened.headRevisionId;
};

/**
 * Opens a new submission on the version it was rendered from, as the page's session, under the id the
 * page minted; a retry of the same id replays. When that version has been replaced, opens on the new
 * one if its schema renders the same, or throws FormUpdatedError for the filler to move over. A retry
 * starts from the version it last sent when that renders the same, since an open whose answer was
 * lost may have landed there.
 */
export function useSubmissionOpener(formId: string, submissionId: string, signedIn: boolean) {
  const { tokenFor } = useCallToken();
  const lastSent = useRef<RenderedVersion | null>(null);
  const open = useCallback(
    async (rendered: RenderedVersion): Promise<string> => {
      const openOn = async (version: RenderedVersion) => {
        lastSent.current = version;
        return headOf(
          await openSobaFormSubmission(
            tokenFor(signedIn),
            formId,
            submissionId,
            version.formVersionId,
          ),
        );
      };
      const first =
        lastSent.current?.schemaHash === rendered.schemaHash ? lastSent.current : rendered;
      try {
        return await openOn(first);
      } catch (err) {
        if (!isVersionReplaced(err)) throw err;
        const form = await getSubmitForm(tokenFor(signedIn), formId);
        // A form now without a published version answers the read above with not_published.
        const latest = await getSubmitFormVersionSchema(
          tokenFor(signedIn),
          form.publishedVersionId ?? '',
        );
        if (latest.schemaHash !== rendered.schemaHash) throw new FormUpdatedError(latest, form);
        return openOn(latest);
      }
    },
    [formId, submissionId, signedIn, tokenFor],
  );
  return { open };
}
