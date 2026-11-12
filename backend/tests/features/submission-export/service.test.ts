jest.mock('../../../src/core/db/repos/submissionExportRepo', () => ({
  ...jest.requireActual('../../../src/core/db/repos/submissionExportRepo'),
  countExportSubmissions: jest.fn(),
  exportSchemaRefs: jest.fn(),
  getExportJob: jest.fn(),
  insertExportAudit: jest.fn(),
}));

jest.mock('../../../src/core/jobs/outputs', () => ({
  ...jest.requireActual('../../../src/core/jobs/outputs'),
  openJobResult: jest.fn(),
}));

jest.mock('../../../src/core/integrations/form-engine/FormEngineRegistry', () => ({
  createFormEngineAdapter: jest.fn(),
}));

jest.mock('../../../src/core/db/repos/formRepo', () => ({
  ...jest.requireActual('../../../src/core/db/repos/formRepo'),
  getFormEngineCodeForForm: jest.fn(),
}));

jest.mock('../../../src/core/services/engineSchema', () => ({
  ...jest.requireActual('../../../src/core/services/engineSchema'),
  readEngineSchema: jest.fn(),
}));

import { getFormEngineCodeForForm } from '../../../src/core/db/repos/formRepo';
import {
  countExportSubmissions,
  exportSchemaRefs,
  getExportJob,
  insertExportAudit,
  type ExportJobRow,
} from '../../../src/core/db/repos/submissionExportRepo';
import { ApiErrorCodes } from '@soba/lib';
import { InternalError, NotFoundError, ValidationError } from '../../../src/core/errors';
import type { FormEngineAdapter } from '../../../src/core/integrations/form-engine/FormEngineAdapter';
import { createFormEngineAdapter } from '../../../src/core/integrations/form-engine/FormEngineRegistry';
import { openJobResult } from '../../../src/core/jobs/outputs';
import { readEngineSchema } from '../../../src/core/services/engineSchema';
import { EXPORT_ACCESS_LOST } from '../../../src/features/submission-export/job';
import {
  exportBounds,
  exportStatusOf,
  submissionExportService,
  toSubmissionExport,
} from '../../../src/features/submission-export/service';

const created = new Date('2026-10-29T17:00:00Z');
const expiresAt = new Date('2026-11-05T17:00:00Z');

const row = (overrides: Partial<ExportJobRow> = {}): ExportJobRow => ({
  jobId: 'job-1',
  status: 'succeeded',
  progressDone: 5,
  progressTotal: 5,
  resultExpiresAt: expiresAt,
  resultExpired: false,
  resultFileId: 'file-1',
  resultFilename: 'Permit 2026-10-29.csv',
  resultSize: 900,
  resultContentType: 'text/csv',
  resultStoredThisRun: true,
  workspaceId: 'ws1',
  formId: 'form-1',
  params: { format: 'csv', layout: 'singleRowCSVExport', to: '2026-10-29T17:00:00.000Z' },
  createdAt: created,
  finishedAt: created,
  cancelRequestedAt: null,
  lastError: null,
  rowCount: 5,
  unreadCount: 0,
  ...overrides,
});

describe('exportStatusOf', () => {
  it.each(['queued', 'running'] as const)('keeps a %s export as it is', (status) => {
    expect(exportStatusOf(row({ status }))).toEqual({ status });
  });

  it('is ready with its file, and expired once past its expiry', () => {
    expect(exportStatusOf(row())).toEqual({ status: 'ready' });
    expect(exportStatusOf(row({ resultExpired: true, resultFileId: null }))).toEqual({
      status: 'expired',
    });
  });

  it('fails a succeeded export that has no file to show', () => {
    expect(
      exportStatusOf(row({ resultExpiresAt: null, resultFileId: null, resultFilename: null })),
    ).toEqual({ status: 'failed', endReason: 'error' });
  });

  it('says a dead export was too large only when the size limit stopped it', () => {
    expect(
      exportStatusOf(
        row({ status: 'dead', lastError: 'Result over the size limit of 52428800 bytes' }),
      ),
    ).toEqual({ status: 'failed', endReason: 'too_large' });
    expect(
      exportStatusOf(row({ status: 'dead', lastError: 'Timed out after 1800000 ms' })),
    ).toEqual({
      status: 'failed',
      endReason: 'error',
    });
  });

  it('tells a stop apart from lost access and anything else that cancelled it', () => {
    expect(
      exportStatusOf(
        row({ status: 'cancelled', cancelRequestedAt: created, lastError: 'aborted' }),
      ),
    ).toEqual({ status: 'cancelled', endReason: 'cancelled' });
    expect(exportStatusOf(row({ status: 'cancelled', lastError: EXPORT_ACCESS_LOST }))).toEqual({
      status: 'cancelled',
      endReason: 'access_lost',
    });
    expect(
      exportStatusOf(row({ status: 'cancelled', lastError: 'Submission export is turned off' })),
    ).toEqual({ status: 'cancelled', endReason: 'error' });
  });
});

describe('toSubmissionExport', () => {
  it('gives the filters it was started with, its progress, counts and file, and no job error', () => {
    expect(toSubmissionExport(row({ lastError: 'should not leak' }))).toEqual({
      id: 'job-1',
      formId: 'form-1',
      format: 'csv',
      layout: 'singleRowCSVExport',
      to: '2026-10-29T17:00:00.000Z',
      status: 'ready',
      createdAt: created.toISOString(),
      finishedAt: created.toISOString(),
      cancelRequestedAt: null,
      progress: { done: 5, total: 5 },
      unreadCount: 0,
      result: {
        state: 'ready',
        filename: 'Permit 2026-10-29.csv',
        size: 900,
        contentType: 'text/csv',
        expiresAt: expiresAt.toISOString(),
      },
    });
  });

  it('leaves out what a queued export does not have yet', () => {
    const queued = toSubmissionExport(
      row({
        status: 'queued',
        progressDone: null,
        progressTotal: null,
        finishedAt: null,
        resultExpiresAt: null,
        resultFileId: null,
        rowCount: null,
        unreadCount: null,
      }),
    );
    expect(queued).not.toHaveProperty('progress');
    expect(queued).not.toHaveProperty('result');
    expect(queued).not.toHaveProperty('unreadCount');
    expect(queued).not.toHaveProperty('endReason');
  });
});

describe('exportBounds', () => {
  const now = new Date('2026-10-29T20:00:00Z');

  it('ends at now when no end is given or the end is later', () => {
    expect(exportBounds({}, now)).toEqual({ to: now.toISOString() });
    expect(exportBounds({ to: '2026-12-01T00:00:00Z' }, now)).toEqual({
      to: now.toISOString(),
    });
  });

  it('keeps an earlier end and the start as given', () => {
    expect(exportBounds({ from: '2026-10-01T07:00:00Z', to: '2026-10-02T07:00:00Z' }, now)).toEqual(
      { from: '2026-10-01T07:00:00.000Z', to: '2026-10-02T07:00:00.000Z' },
    );
  });

  it('refuses a start at or after now', () => {
    expect(() => exportBounds({ from: '2026-10-30T00:00:00Z' }, now)).toThrow(ValidationError);
  });
});

describe('submissionExportService.fields', () => {
  const ctx = { actorId: 'starter', workspaceId: 'ws1', formId: 'form-1' };
  const SUBMISSION_FIELDS = [
    'form.confirmationId',
    'form.submissionId',
    'form.formVersionId',
    'form.submittedAt',
    'form.submitter',
    'form.username',
    'form.email',
  ];
  const field = (key: string) => ({ type: 'textfield', key, input: true });
  const SCHEMAS: Record<string, Record<string, unknown>> = {
    'ref-v2': { components: [field('name'), field('email')] },
    'ref-v1': { components: [field('phone'), field('name')] },
  };
  const refs = (...names: string[]) => names.map((ref) => ({ versionId: ref.slice(4), ref }));

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getFormEngineCodeForForm).mockResolvedValue('formio-v5');
    jest
      .mocked(readEngineSchema)
      .mockImplementation((_code, ref) => Promise.resolve(SCHEMAS[ref!] ?? null));
    jest.mocked(countExportSubmissions).mockResolvedValue(0);
  });

  it("lists the newest version's fields first, then fields only older versions have", async () => {
    jest.mocked(exportSchemaRefs).mockResolvedValue(refs('ref-v2', 'ref-v1'));

    const { fields } = await submissionExportService.fields(ctx, {});

    expect(fields).toEqual([...SUBMISSION_FIELDS, 'name', 'email', 'phone']);
    expect(exportSchemaRefs).toHaveBeenCalledWith('ws1', 'form-1', undefined);
    expect(jest.mocked(readEngineSchema).mock.calls).toEqual([
      ['formio-v5', 'ref-v2'],
      ['formio-v5', 'ref-v1'],
    ]);
  });

  it("lists only the chosen version's fields", async () => {
    jest.mocked(exportSchemaRefs).mockResolvedValue(refs('ref-v1'));

    const { fields } = await submissionExportService.fields(ctx, { formVersionId: 'v1' });

    expect(fields).toEqual([...SUBMISSION_FIELDS, 'phone', 'name']);
    expect(exportSchemaRefs).toHaveBeenCalledWith('ws1', 'form-1', 'v1');
  });

  it("lists only the submission's fields when the form has no engine", async () => {
    jest.mocked(getFormEngineCodeForForm).mockResolvedValue(null);

    const { fields } = await submissionExportService.fields(ctx, {});

    expect(fields).toEqual(SUBMISSION_FIELDS);
    expect(readEngineSchema).not.toHaveBeenCalled();
  });

  it('leaves out a version the engine no longer has', async () => {
    jest.mocked(exportSchemaRefs).mockResolvedValue(refs('ref-v2', 'ref-gone', 'ref-v1'));
    jest
      .mocked(readEngineSchema)
      .mockImplementation((_code, ref) =>
        ref === 'ref-gone'
          ? Promise.reject(
              new InternalError(
                'Form engine document is missing',
                ApiErrorCodes.engine_document_missing,
              ),
            )
          : Promise.resolve(SCHEMAS[ref!]),
      );

    const { fields } = await submissionExportService.fields(ctx, {});

    expect(fields).toEqual([...SUBMISSION_FIELDS, 'name', 'email', 'phone']);
  });

  it('reads only the schemas from the engine, never a submission', async () => {
    const { readEngineSchema: realRead } = jest.requireActual<
      typeof import('../../../src/core/services/engineSchema')
    >('../../../src/core/services/engineSchema');
    const adapter = {
      readSchema: jest.fn((ref: string) => Promise.resolve(SCHEMAS[ref] ?? null)),
      readSubmissions: jest.fn(),
    };
    jest.mocked(createFormEngineAdapter).mockReturnValue(adapter as unknown as FormEngineAdapter);
    jest.mocked(readEngineSchema).mockImplementation(realRead);
    jest.mocked(exportSchemaRefs).mockResolvedValue(refs('ref-v2', 'ref-v1'));

    const { fields } = await submissionExportService.fields(ctx, {});

    expect(fields).toEqual([...SUBMISSION_FIELDS, 'name', 'email', 'phone']);
    expect(adapter.readSchema).toHaveBeenCalledTimes(2);
    expect(adapter.readSubmissions).not.toHaveBeenCalled();
  });

  it('fails when the engine cannot be read', async () => {
    jest.mocked(exportSchemaRefs).mockResolvedValue(refs('ref-v2'));
    jest.mocked(readEngineSchema).mockRejectedValue(new Error('engine down'));

    await expect(submissionExportService.fields(ctx, {})).rejects.toThrow('engine down');
  });

  it('counts the submissions the version and dates cover', async () => {
    jest.mocked(exportSchemaRefs).mockResolvedValue([]);
    jest.mocked(countExportSubmissions).mockResolvedValue(7);
    const from = '2026-10-01T07:00:00.000Z';
    const to = '2026-10-02T07:00:00.000Z';

    const { count } = await submissionExportService.fields(ctx, { formVersionId: 'v1', from, to });

    expect(count).toBe(7);
    expect(countExportSubmissions).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      formId: 'form-1',
      formVersionId: 'v1',
      from: new Date(from),
      to: new Date(to),
    });
  });
});

describe('submissionExportService.openDownload', () => {
  const ctx = { actorId: 'starter', workspaceId: 'ws1', formId: 'form-1' };

  beforeEach(() => jest.clearAllMocks());

  it("refuses another user's export as not found, opening no file and recording nothing", async () => {
    jest.mocked(getExportJob).mockResolvedValue(undefined);

    await expect(
      submissionExportService.openDownload({ ...ctx, actorId: 'someone' }, 'job-1'),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(getExportJob).toHaveBeenCalledWith('form-1', 'someone', 'job-1');
    expect(openJobResult).not.toHaveBeenCalled();
    expect(insertExportAudit).not.toHaveBeenCalled();
  });

  it("opens the starter's ready file and records the download", async () => {
    const opened = {
      state: 'ready',
      file: { id: 'file-1', size: 900 },
      content: { downloadStream: undefined },
    };
    jest.mocked(getExportJob).mockResolvedValue(row());
    jest.mocked(openJobResult).mockResolvedValue(opened as never);

    await expect(submissionExportService.openDownload(ctx, 'job-1')).resolves.toBe(opened);

    expect(insertExportAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ jobId: 'job-1', fileId: 'file-1', actorId: 'starter' }),
    );
  });
});
