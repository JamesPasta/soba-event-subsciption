/** Background jobs as a form's or a workspace's staff and platform administrators read them. */
import type {
  JobEmailCounts,
  JobProgress,
  JobResult,
  JobSummary,
  StaffJobListItem,
} from '@soba/lib';
import type { ListQueryArgs } from './list';

export type {
  JobEmailCounts,
  JobFormItem,
  JobProgress,
  JobResult,
  JobSummary,
  JobTypeItem,
  ListJobFormsResponse as JobFormsResponse,
  ListStaffJobsResponse as StaffJobsResponse,
  StaffJobActor,
  StaffJobDetail,
  StaffJobListItem,
} from '@soba/lib';

export type JobStatus = StaffJobListItem['status'];

/** Whose jobs: a form's, or a workspace's. */
export type JobScopeRef =
  | { kind: 'form'; formId: string }
  | { kind: 'workspace'; workspaceId: string };

/** The filters a staff jobs list sends; only a workspace's list takes a form. */
export type StaffJobFilters = {
  status?: JobStatus;
  type?: string;
  formId?: string;
};

export type StaffJobsQuery = ListQueryArgs & StaffJobFilters;

/** What a job page shows whoever reads it: the fields the admin and staff details share. */
export type JobViewModel = {
  id: string;
  type: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  runAfter: string;
  startedAt: string | null;
  finishedAt: string | null;
  cancelRequestedAt: string | null;
  requeueCount: number;
  lastRequeuedAt: string | null;
  lastError: string | null;
  recordedActions: string[];
  parentJobId: string | null;
  childrenQueuedAt: string | null;
  parent?: JobSummary;
  children: JobSummary[];
  emailCounts?: JobEmailCounts;
  progress?: JobProgress;
  result?: JobResult;
};
