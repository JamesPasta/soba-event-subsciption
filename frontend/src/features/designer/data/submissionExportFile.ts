import { downloadSobaSubmissionExport } from '@/src/shared/api/sobaApi';

/** Loads one of the caller's ready exports. */
export const submissionExportFileLoader = (formId: string, exportId: string) => (token: string) =>
  downloadSobaSubmissionExport(token, formId, exportId);
