import type { MySubmissionListItem, SubmitterForm } from '@soba/lib';

export type {
  SubmissionListItem,
  SubmissionResponse,
  SubmitSubmissionResponse,
  SubmissionRevisionInfo,
  SubmissionWriteResponse,
  ListSubmissionsResponse,
  SubmissionDataBody,
  SubmitSubmissionBody,
  MySubmissionListItem,
  MySubmissionState,
  ListMySubmissionsResponse,
  ReviseSubmissionBody,
} from '@soba/lib';
export type { SubmitterReviewLabel } from '@soba/lib';
export { MY_SUBMISSION_STATES, SubmissionWorkflowState, SubmitterReviewLabels } from '@soba/lib';

/** A My Submissions row with its form's facts for the caller; null when the page carried none. */
export type MySubmissionRow = MySubmissionListItem & { form: SubmitterForm | null };
