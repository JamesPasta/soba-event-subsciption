'use client';

import { InlineAlert } from '@bcgov/design-system-react-components';
import type { DataError } from '@/src/shared/api/dataContracts';
import { messageForDataError, type DataErrorMessages } from '@/src/shared/api/dataError';

type DataErrorTestIds = Partial<Record<DataError['kind'], string>> & { failed: string };

/** A load failure as an inline alert. Callers own the copy and the test ids per error kind. */
export function LoadErrorAlert({
  error,
  messages,
  testIds,
}: Readonly<{ error: DataError; messages: DataErrorMessages; testIds: DataErrorTestIds }>) {
  return (
    <InlineAlert variant="danger" role="alert" data-testid={testIds[error.kind] ?? testIds.failed}>
      {messageForDataError(error, messages)}
    </InlineAlert>
  );
}
