import {
  isActiveExportStatus,
  StartSubmissionExportBodySchema,
  SUBMISSION_EXPORT_MAX_FIELD_LENGTH,
  SUBMISSION_EXPORT_MAX_FIELDS,
  SUBMISSION_EXPORT_STATUSES,
  SubmissionExportFieldsBodySchema,
  SubmissionExportFieldsResponseSchema,
  SubmissionExportSchema,
} from '../../src/schemas/submissionExport';

const FROM = '2026-10-01T00:00:00Z';
const TO = '2026-10-02T00:00:00Z';

describe('StartSubmissionExportBodySchema', () => {
  it('defaults to CSV with no filters', () => {
    expect(StartSubmissionExportBodySchema.parse({})).toEqual({ format: 'csv' });
  });

  it('accepts a range with from before to', () => {
    expect(StartSubmissionExportBodySchema.safeParse({ from: FROM, to: TO }).success).toBe(true);
  });

  it.each([
    ['only from', { from: FROM }],
    ['only to', { to: TO }],
  ])('accepts a half-open range with %s', (_label, body) => {
    expect(StartSubmissionExportBodySchema.safeParse(body).success).toBe(true);
  });

  it.each([
    ['empty', { from: FROM, to: FROM }],
    ['ending before it starts', { from: TO, to: FROM }],
  ])('refuses a range %s', (_label, body) => {
    expect(StartSubmissionExportBodySchema.safeParse(body).success).toBe(false);
  });

  it.each([
    ['format', { format: 'xlsx' }],
    ['layout', { layout: 'fancy' }],
    ['version id', { formVersionId: 'v1' }],
    ['date', { from: '2026-10-01' }],
  ])('refuses an unknown %s', (_label, body) => {
    expect(StartSubmissionExportBodySchema.safeParse(body).success).toBe(false);
  });
});

describe('SubmissionExportFieldsBodySchema', () => {
  it('takes the filters only', () => {
    expect(
      SubmissionExportFieldsBodySchema.parse({ layout: 'singleRowCSVExport', format: 'json' }),
    ).toEqual({ layout: 'singleRowCSVExport' });
  });

  it('refuses a range ending before it starts', () => {
    expect(SubmissionExportFieldsBodySchema.safeParse({ from: TO, to: FROM }).success).toBe(false);
  });
});

describe('SubmissionExportFieldsResponseSchema', () => {
  it('needs the fields and a whole-number count', () => {
    expect(
      SubmissionExportFieldsResponseSchema.safeParse({ fields: ['form.submitter'], count: 0 })
        .success,
    ).toBe(true);
    expect(SubmissionExportFieldsResponseSchema.safeParse({ fields: [] }).success).toBe(false);
    expect(SubmissionExportFieldsResponseSchema.safeParse({ fields: [], count: 1.5 }).success).toBe(
      false,
    );
  });
});

describe('SubmissionExportSchema', () => {
  const record = {
    id: 'e1',
    formId: 'f1',
    format: 'csv',
    status: 'queued',
    createdAt: FROM,
    finishedAt: null,
    cancelRequestedAt: null,
  };

  it('accepts a queued export', () => {
    expect(SubmissionExportSchema.safeParse(record).success).toBe(true);
  });

  it('accepts a ready export with its progress and file', () => {
    expect(
      SubmissionExportSchema.safeParse({
        ...record,
        status: 'ready',
        finishedAt: TO,
        progress: { done: 12, total: 12 },
        unreadCount: 0,
        result: { state: 'ready', expiresAt: TO, filename: 'Permit.csv', size: 300 },
      }).success,
    ).toBe(true);
  });

  it('refuses an unknown status or end reason', () => {
    expect(SubmissionExportSchema.safeParse({ ...record, status: 'completed' }).success).toBe(
      false,
    );
    expect(
      SubmissionExportSchema.safeParse({ ...record, status: 'failed', endReason: 'crashed' })
        .success,
    ).toBe(false);
  });
});

describe('isActiveExportStatus', () => {
  it('counts a queued or running export as active, and nothing else', () => {
    expect(SUBMISSION_EXPORT_STATUSES.filter(isActiveExportStatus)).toEqual(['queued', 'running']);
  });
});

describe('the start body limits', () => {
  it('refuses more fields than allowed, or a field name too long', () => {
    const many = Array.from(
      { length: SUBMISSION_EXPORT_MAX_FIELDS + 1 },
      (_, index) => `f${index}`,
    );
    expect(StartSubmissionExportBodySchema.safeParse({ fields: many }).success).toBe(false);
    expect(
      StartSubmissionExportBodySchema.safeParse({
        fields: ['x'.repeat(SUBMISSION_EXPORT_MAX_FIELD_LENGTH + 1)],
      }).success,
    ).toBe(false);
    expect(StartSubmissionExportBodySchema.safeParse({ fields: [''] }).success).toBe(false);
  });
});
