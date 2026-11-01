import { z } from 'zod';
import { OffsetPageSchema, makeSortEnum } from './pagination';
import { JOB_SORT_FIELDS } from '../sort';

/** A background job's status, as the job table records it. */
export const JOB_STATUSES = ['queued', 'running', 'succeeded', 'dead', 'cancelled'] as const;
export const JobStatusSchema = z.enum(JOB_STATUSES);

export const JobSortSchema = makeSortEnum(JOB_SORT_FIELDS);

/** A related job: a parent or a child. */
export const JobSummarySchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  status: JobStatusSchema,
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
});
export type JobSummary = z.infer<typeof JobSummarySchema>;

/** How far a job has got; `total` is null when the job does not know it. */
export const JobProgressSchema = z.object({
  done: z.number().int().min(0),
  total: z.number().int().min(0).nullable(),
});
export type JobProgress = z.infer<typeof JobProgressSchema>;

export const JOB_RESULT_STATES = ['ready', 'expired'] as const;

/**
 * The file a succeeded job produced: ready to download until `expiresAt`, then expired. The file's
 * name, size and type are given only while it is ready.
 */
export const JobResultSchema = z.object({
  state: z.enum(JOB_RESULT_STATES),
  expiresAt: z.string(),
  filename: z.string().optional(),
  size: z.number().int().nullable().optional(),
  contentType: z.string().nullable().optional(),
});
export type JobResult = z.infer<typeof JobResultSchema>;

/**
 * Where a job's emails stand, by address: sent, refused by the provider, or not sent yet. A re-run
 * sends to those not sent yet and tries the refused ones again. Counts only, never addresses.
 */
export const JobEmailCountsSchema = z.object({
  addresses: z.number().int(),
  sent: z.number().int(),
  refused: z.number().int(),
  pending: z.number().int(),
});
export type JobEmailCounts = z.infer<typeof JobEmailCountsSchema>;

/**
 * A job as a form's or a workspace's list shows it: the jobs that form's or workspace's submissions
 * started. No workspace, form, revision or user ids; `lastError` never holds an address.
 */
export const StaffJobListItemSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  status: JobStatusSchema,
  attempts: z.number().int(),
  maxAttempts: z.number().int(),
  formName: z.string().nullable(),
  confirmationCode: z.string().nullable(),
  /** The submission, while its page can open; null once it or its form version is deleted. */
  submissionId: z.string().uuid().nullable(),
  createdAt: z.string(),
  runAfter: z.string(),
  finishedAt: z.string().nullable(),
  cancelRequestedAt: z.string().nullable(),
  requeueCount: z.number().int(),
  lastError: z.string().nullable(),
});
export type StaffJobListItem = z.infer<typeof StaffJobListItemSchema>;

export const ListStaffJobsResponseSchema = z.object({
  items: z.array(StaffJobListItemSchema),
  page: OffsetPageSchema,
  filters: z.object({
    status: JobStatusSchema.optional(),
    type: z.string().optional(),
    formId: z.string().optional(),
  }),
  sort: JobSortSchema,
});
export type ListStaffJobsResponse = z.infer<typeof ListStaffJobsResponseSchema>;

/**
 * Where someone who ran a job again or asked it to stop stands now: an active member of the job's
 * workspace, a platform administrator who is not one and acted through the administration routes,
 * or a former member.
 */
export const JOB_ACTOR_STANDINGS = ['member', 'platformAdministrator', 'formerMember'] as const;

/** Someone who ran a job again or asked it to stop. Named only while a member. */
export const StaffJobActorSchema = z.object({
  standing: z.enum(JOB_ACTOR_STANDINGS),
  /** Null unless a member. */
  displayLabel: z.string().nullable(),
});
export type StaffJobActor = z.infer<typeof StaffJobActorSchema>;

/** One job with its relations, for a form's or a workspace's staff. Options are never shown. */
export const StaffJobDetailSchema = StaffJobListItemSchema.extend({
  startedAt: z.string().nullable(),
  /** Who queued it: the submitter. */
  createdBy: z.object({ displayLabel: z.string().nullable() }),
  lastRequeuedAt: z.string().nullable(),
  lastRequeuedBy: StaffJobActorSchema.nullable(),
  cancelRequestedBy: StaffJobActorSchema.nullable(),
  /** The action codes a submission-received job recorded. */
  recordedActions: z.array(z.string()),
  parentJobId: z.string().uuid().nullable(),
  /** When the job queued its children, which stays set after they are deleted. */
  childrenQueuedAt: z.string().nullable(),
  /** Absent when the job has none, or it is no longer kept. */
  parent: JobSummarySchema.optional(),
  children: z.array(JobSummarySchema),
  /** Present for a job that sends emails to a list of addresses. */
  emailCounts: JobEmailCountsSchema.optional(),
});
export type StaffJobDetail = z.infer<typeof StaffJobDetailSchema>;

/** A form that has jobs in a workspace, for the workspace list's form filter. */
export const JobFormItemSchema = z.object({ id: z.string().uuid(), name: z.string() });
export type JobFormItem = z.infer<typeof JobFormItemSchema>;

export const ListJobFormsResponseSchema = z.object({ items: z.array(JobFormItemSchema) });
export type ListJobFormsResponse = z.infer<typeof ListJobFormsResponseSchema>;
