import type { ApiErrorCode } from '@soba/lib';
import { apiErrorMessage } from '@/src/shared/api/dataError';
import type { DataErrorNoticeMessages } from '@/src/shared/api/useDataErrorNotice';

/** Messages for a failed print: the server's message for its code, else the generic failure. */
export function printFailureMessages(
  cause: unknown,
  apiErrors: Record<ApiErrorCode, string>,
  failed: string,
): DataErrorNoticeMessages {
  const message = apiErrorMessage(cause, apiErrors);
  return message ? { failed: message, forbidden: message } : { failed };
}
