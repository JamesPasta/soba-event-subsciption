import { resultFacts, toJobOutput } from '../../../src/core/jobs/outputs';
import type { JobOutputRow } from '../../../src/core/db/repos/jobOutputRepo';

const expiresAt = new Date('2026-11-05T12:00:00Z');

const row = (overrides: Partial<JobOutputRow> = {}): JobOutputRow => ({
  jobId: 'job-1',
  status: 'succeeded',
  progressDone: 120,
  progressTotal: 120,
  resultExpiresAt: expiresAt,
  resultExpired: false,
  resultFileId: 'file-1',
  resultFilename: 'Intake 2026-10-29.csv',
  resultSize: 2048,
  resultContentType: 'text/csv',
  resultStoredThisRun: true,
  ...overrides,
});

describe('resultFacts', () => {
  it('shows the file a succeeded run stored until it expires', () => {
    expect(resultFacts(row())).toEqual({
      state: 'ready',
      filename: 'Intake 2026-10-29.csv',
      size: 2048,
      contentType: 'text/csv',
      expiresAt,
    });
  });

  it('reads as expired once past its expiry, with or without the file', () => {
    expect(resultFacts(row({ resultExpired: true }))).toEqual({ state: 'expired', expiresAt });
    expect(
      resultFacts(row({ resultExpired: true, resultFileId: null, resultFilename: null })),
    ).toEqual({ state: 'expired', expiresAt });
  });

  it('hides a file an earlier attempt stored', () => {
    expect(resultFacts(row({ resultStoredThisRun: false }))).toBeNull();
  });

  it.each(['queued', 'running', 'dead', 'cancelled'])('shows nothing on a %s job', (status) => {
    expect(resultFacts(row({ status }))).toBeNull();
  });

  it('shows nothing for a job that never stored a result', () => {
    expect(
      resultFacts(
        row({ resultExpiresAt: null, resultFileId: null, resultFilename: null, resultSize: null }),
      ),
    ).toBeNull();
  });
});

describe('toJobOutput', () => {
  it('carries progress once the job has reported any', () => {
    expect(toJobOutput(row({ status: 'running', progressDone: 3, progressTotal: null }))).toEqual({
      progress: { done: 3, total: null },
      result: null,
    });
    expect(toJobOutput(row({ status: 'queued', progressDone: null })).progress).toBeNull();
  });
});
