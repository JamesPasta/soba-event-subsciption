'use client';

import { InlineAlert } from '@bcgov/design-system-react-components';
import type { DataError } from '@/src/shared/api/dataContracts';
import { messageForDataError } from '@/src/shared/api/dataError';
import type { Dictionary } from '@/src/types/dictionary';

/** What an action does, and why its settings did not load when they did not. */
export default function ActionDrawerIntro({
  dict,
  id,
  description,
  error,
}: Readonly<{ dict: Dictionary; id: string; description: string; error: DataError | null }>) {
  return (
    <>
      <p data-testid={`${id}-description`}>{description}</p>
      {error && (
        <InlineAlert
          variant="warning"
          title={messageForDataError(error, {
            sessionExpired: dict.general.sessionExpired,
            forbidden: dict.general.noAccess,
            failed: dict.postSubmission.settingsLoadError,
          })}
          data-testid={`${id}-error`}
        />
      )}
    </>
  );
}
