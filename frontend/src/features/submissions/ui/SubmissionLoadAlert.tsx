'use client';

import { useDictionary } from '@/app/[lang]/Providers';
import type { DataError } from '@/src/shared/api/dataContracts';
import { apiErrorMessage } from '@/src/shared/api/dataError';
import { useAuthErrorDefaults } from '@/src/shared/api/useDataErrorNotice';
import { LoadErrorAlert } from '@/src/shared/ui/LoadErrorAlert';

/** A submission read failure, with the submission-specific copy and test ids. */
export function SubmissionLoadAlert({ error }: Readonly<{ error: DataError }>) {
  const dict = useDictionary();
  const authDefaults = useAuthErrorDefaults();
  return (
    <LoadErrorAlert
      error={error}
      messages={{
        ...authDefaults,
        notFound: dict.submission.notFound,
        failed: apiErrorMessage(error.cause, dict.apiErrors) ?? dict.submission.loadError,
      }}
      testIds={{
        sessionExpired: 'submission-view-session-expired',
        forbidden: 'submission-view-noaccess',
        notFound: 'submission-view-notfound',
        failed: 'submission-view-loaderror',
      }}
    />
  );
}
