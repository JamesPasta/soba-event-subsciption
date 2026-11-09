import { downloadSobaSubmissionFile } from '@/src/shared/api/sobaApi';

/** Loads a submission's file, for staff. */
export const submissionFileLoader = (submissionId: string, fileId: string) => (token: string) =>
  downloadSobaSubmissionFile(token, submissionId, fileId);
