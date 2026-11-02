import { z } from 'zod';
import { SubmissionWorkflowState, type SubmissionWorkflowStateCode } from '../permissions/codes';
import { SUBMISSION_EXPORT_SORT_FIELDS } from '../sort';
import { JobProgressSchema, JobResultSchema } from './jobs';
import { OffsetPageSchema, makeSortEnum } from './pagination';

const SUBMISSION_EXPORT_FORMATS = ['csv', 'json'] as const;
export type SubmissionExportFormat = (typeof SUBMISSION_EXPORT_FORMATS)[number];

/** CHEFS 1 CSV layouts; the first is the default. */
export const SUBMISSION_EXPORT_LAYOUTS = [
  'multiRowEmptySpacesCSVExport',
  'multiRowBackFilledCSVExport',
  'singleRowCSVExport',
  'unFormattedCSVExport',
] as const;
export type SubmissionExportLayout = (typeof SUBMISSION_EXPORT_LAYOUTS)[number];

/** The submission workflow states an export includes; a deleted submission never is. */
export const SUBMISSION_EXPORT_STATES: readonly SubmissionWorkflowStateCode[] = [
  SubmissionWorkflowState.submitted,
];

/**
 * Where an export stands. `ready` has a file to download until it expires; `failed` and `cancelled`
 * say why in `endReason`.
 */
export const SUBMISSION_EXPORT_STATUSES = [
  'queued',
  'running',
  'ready',
  'expired',
  'failed',
  'cancelled',
] as const;
export type SubmissionExportStatus = (typeof SUBMISSION_EXPORT_STATUSES)[number];

/** Still to finish: counts toward the person's limit, and the page keeps reading it. */
export const isActiveExportStatus = (status: SubmissionExportStatus): boolean =>
  status === 'queued' || status === 'running';

/**
 * Why a failed or cancelled export ended: its file was over the size limit, its starter can no
 * longer read the form's submissions, something went wrong, or someone stopped it.
 */
export const SUBMISSION_EXPORT_END_REASONS = [
  'too_large',
  'access_lost',
  'error',
  'cancelled',
] as const;
export type SubmissionExportEndReason = (typeof SUBMISSION_EXPORT_END_REASONS)[number];

/** Most fields an export may name, and the longest field name. */
export const SUBMISSION_EXPORT_MAX_FIELDS = 1000;
export const SUBMISSION_EXPORT_MAX_FIELD_LENGTH = 500;

const FiltersSchema = z.object({
  // Absent means every version.
  formVersionId: z.uuid().optional(),
  // Submitted in [from, to); either bound may be absent.
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  // CSV only.
  layout: z.enum(SUBMISSION_EXPORT_LAYOUTS).optional(),
});

const rangeIsValid = (body: { from?: string; to?: string }) =>
  !body.from || !body.to || new Date(body.from) < new Date(body.to);

const RANGE_MESSAGE = { message: 'from must be before to' };

export const SubmissionExportFieldsBodySchema = FiltersSchema.refine(rangeIsValid, RANGE_MESSAGE);

export const SubmissionExportFieldsResponseSchema = z.object({
  fields: z.array(z.string()),
  /** How many submissions the filters cover. */
  count: z.number().int(),
});

const StartFieldsSchema = FiltersSchema.extend({
  format: z.enum(SUBMISSION_EXPORT_FORMATS).default('csv'),
  // CSV only; absent means all.
  fields: z
    .array(z.string().min(1).max(SUBMISSION_EXPORT_MAX_FIELD_LENGTH))
    .max(SUBMISSION_EXPORT_MAX_FIELDS)
    .optional(),
});

export const StartSubmissionExportBodySchema = StartFieldsSchema.refine(
  rangeIsValid,
  RANGE_MESSAGE,
);

export const SubmissionExportSchema = StartFieldsSchema.extend({
  id: z.string(),
  formId: z.string(),
  status: z.enum(SUBMISSION_EXPORT_STATUSES),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
  /** Set once someone asked to stop it; a running export stops at its next check. */
  cancelRequestedAt: z.string().nullable(),
  /** Present once it has started counting rows. */
  progress: JobProgressSchema.optional(),
  /** Present when it failed or was cancelled. */
  endReason: z.enum(SUBMISSION_EXPORT_END_REASONS).optional(),
  /** Submissions it could not read, and left out; present once it finished. */
  unreadCount: z.number().int().optional(),
  /** The file, while ready or once expired. */
  result: JobResultSchema.optional(),
});

export const SubmissionExportSortSchema = makeSortEnum(SUBMISSION_EXPORT_SORT_FIELDS);

/** One page of the caller's exports of a form. */
export const SubmissionExportListSchema = z.object({
  items: z.array(SubmissionExportSchema),
  page: OffsetPageSchema,
  sort: SubmissionExportSortSchema,
});

export type SubmissionExportFieldsBody = z.infer<typeof SubmissionExportFieldsBodySchema>;
export type SubmissionExportFieldsResponse = z.infer<typeof SubmissionExportFieldsResponseSchema>;
export type StartSubmissionExportBody = z.infer<typeof StartSubmissionExportBodySchema>;
export type SubmissionExport = z.infer<typeof SubmissionExportSchema>;
export type SubmissionExportList = z.infer<typeof SubmissionExportListSchema>;
export type SubmissionExportSort = z.infer<typeof SubmissionExportSortSchema>;
