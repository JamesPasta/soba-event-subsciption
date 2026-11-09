import { JOB_STATUSES } from '@soba/lib';
import type { StatusTagVariant } from '@/src/components/StatusTag';
import {
  postSubmissionActionCodes,
  postSubmissionActionUi,
} from '@/src/features/post-submission/actions/registry';
import type { Dictionary } from '@/src/types/dictionary';
import type { JobStatus, JobTypeItem, JobViewModel } from '@/src/types/jobs';

const SUBMISSION_SUBMITTED = 'submission.submitted';
const SUBMISSION_EXPORT = 'submission-export';

/** Text to show, and `lang` when only the server names it, which it does in English. */
export type JobTypeLabel = { text: string; lang?: 'en' };

/**
 * A job type in the reader's language when this build knows it, else the name the server gives it,
 * else its code.
 */
export const jobTypeLabel = (
  type: string,
  dict: Dictionary,
  types: readonly JobTypeItem[] = [],
): JobTypeLabel => {
  if (type === SUBMISSION_SUBMITTED) return { text: dict.jobs.types.submissionSubmitted };
  if (type === SUBMISSION_EXPORT) return { text: dict.jobs.types.submissionExport };
  const action = postSubmissionActionUi(type);
  if (action) return { text: action.label(dict) };
  return { text: types.find((item) => item.type === type)?.name ?? type, lang: 'en' };
};

/** The types a submission's jobs can have that this build names: submission received and its actions. */
export const submissionJobTypes = (): string[] => [
  SUBMISSION_SUBMITTED,
  ...postSubmissionActionCodes(),
];

const STATUS_VARIANTS: Record<JobStatus, StatusTagVariant> = {
  queued: 'primary',
  running: 'info',
  succeeded: 'success',
  dead: 'warning',
  cancelled: 'neutral',
};

export const jobStatusVariant = (status: JobStatus): StatusTagVariant => STATUS_VARIANTS[status];

export const toJobStatus = (raw: string | undefined): JobStatus | undefined =>
  JOB_STATUSES.find((status) => status === raw);

export const isActiveJobStatus = (status: JobStatus): boolean =>
  status === 'queued' || status === 'running';

export const canRerunJob = (status: JobStatus): boolean =>
  status === 'dead' || status === 'cancelled';

/** An export is its starter's own request: they start a new one rather than run it again. */
export const isExportJob = (type: string): boolean => type === SUBMISSION_EXPORT;

/**
 * A submission-received job that queued its actions: the server refuses to run it again, since its
 * actions' jobs are the ones to run.
 */
export const queuedItsActions = (
  job: Pick<JobViewModel, 'type' | 'childrenQueuedAt' | 'children'>,
): boolean =>
  job.type === SUBMISSION_SUBMITTED && (job.childrenQueuedAt !== null || job.children.length > 0);
