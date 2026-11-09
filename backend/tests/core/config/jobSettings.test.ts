import { env, resolveJobSettings, resolveShutdownSettings } from '../../../src/core/config/env';

describe('resolveJobSettings', () => {
  it('uses the defaults when nothing is set', () => {
    expect(resolveJobSettings({})).toEqual({
      pools: ['light', 'heavy'],
      pollMs: { light: 2_000, heavy: 10_000 },
      leaseMs: { light: 60_000, heavy: 90_000 },
      concurrency: { light: 4, heavy: 1 },
      timeoutMs: { light: 300_000, heavy: 1_800_000 },
      maxAttempts: 3,
      backoffBaseMs: 30_000,
      backoffMaxMs: 1_800_000,
      sweepIntervalMs: 60_000,
      retentionBatch: 1000,
      succeededRetentionDays: 30,
      deadRetentionDays: 90,
      drainMs: 15_000,
      abortGraceMs: 2_000,
      progressIntervalMs: 5_000,
      resultMaxBytes: 209_715_200,
      resultRetentionDays: 7,
      resultSweepBatch: 100,
      resultsStorageProfile: 'default',
      resultsStoragePrefix: 'job-results',
    });
  });

  it('reads each setting from its variable', () => {
    const settings = resolveJobSettings({
      JOB_LIGHT_POLL_MS: '500',
      JOB_HEAVY_POLL_MS: '5000',
      JOB_LIGHT_LEASE_MS: '30000',
      JOB_HEAVY_LEASE_MS: '120000',
      JOB_LIGHT_CONCURRENCY: '8',
      JOB_HEAVY_CONCURRENCY: '2',
      JOB_LIGHT_TIMEOUT_MS: '60000',
      JOB_HEAVY_TIMEOUT_MS: '600000',
      JOB_MAX_ATTEMPTS: '5',
      JOB_BACKOFF_BASE_MS: '1000',
      JOB_BACKOFF_MAX_MS: '60000',
      JOB_SWEEP_INTERVAL_MS: '15000',
      JOB_RETENTION_BATCH: '200',
      JOB_SUCCEEDED_RETENTION_DAYS: '7',
      JOB_DEAD_RETENTION_DAYS: '14',
      JOB_DRAIN_MS: '10000',
      JOB_ABORT_GRACE_MS: '500',
      JOB_PROGRESS_INTERVAL_MS: '2000',
      JOB_RESULT_MAX_BYTES: '52428800',
      JOB_RESULT_RETENTION_DAYS: '1',
      JOB_RESULT_SWEEP_BATCH: '20',
      JOB_RESULTS_STORAGE_PROFILE: 'exports',
      JOB_RESULTS_STORAGE_PREFIX: 'soba/job-results',
    });
    expect(settings).toMatchObject({
      pollMs: { light: 500, heavy: 5000 },
      leaseMs: { light: 30_000, heavy: 120_000 },
      concurrency: { light: 8, heavy: 2 },
      timeoutMs: { light: 60_000, heavy: 600_000 },
      maxAttempts: 5,
      backoffBaseMs: 1000,
      backoffMaxMs: 60_000,
      sweepIntervalMs: 15_000,
      retentionBatch: 200,
      succeededRetentionDays: 7,
      deadRetentionDays: 14,
      drainMs: 10_000,
      abortGraceMs: 500,
      progressIntervalMs: 2_000,
      resultMaxBytes: 52_428_800,
      resultRetentionDays: 1,
      resultSweepBatch: 20,
      resultsStorageProfile: 'exports',
      resultsStoragePrefix: 'soba/job-results',
    });
  });

  it('writes progress at most every second', () => {
    expect(() => resolveJobSettings({ JOB_PROGRESS_INTERVAL_MS: '999' })).toThrow(
      "JOB_PROGRESS_INTERVAL_MS must be a whole number from 1000 to 2147483647, got '999'",
    );
  });

  it('caps a result at the largest file size a file row holds', () => {
    expect(() => resolveJobSettings({ JOB_RESULT_MAX_BYTES: '2147483648' })).toThrow(
      "JOB_RESULT_MAX_BYTES must be a whole number from 1 to 2147483647, got '2147483648'",
    );
  });

  it('stops on a results prefix storage would refuse', () => {
    expect(() => resolveJobSettings({ JOB_RESULTS_STORAGE_PREFIX: 'Job Results' })).toThrow(
      "JOB_RESULTS_STORAGE_PREFIX is not a valid storage prefix, got 'Job Results'",
    );
  });

  it.each(['0', '-1', '1.5', 'abc', '2147483648'])('stops on %s, naming the variable', (raw) => {
    expect(() => resolveJobSettings({ JOB_LIGHT_CONCURRENCY: raw })).toThrow(
      `JOB_LIGHT_CONCURRENCY must be a whole number from 1 to 2147483647, got '${raw}'`,
    );
  });

  it('requires a lease of at least a second', () => {
    expect(() => resolveJobSettings({ JOB_LIGHT_LEASE_MS: '999' })).toThrow(
      "JOB_LIGHT_LEASE_MS must be a whole number from 1000 to 2147483647, got '999'",
    );
    expect(resolveJobSettings({ JOB_LIGHT_LEASE_MS: '1000' }).leaseMs.light).toBe(1000);
  });

  it('caps retention at 36500 days', () => {
    expect(() => resolveJobSettings({ JOB_DEAD_RETENTION_DAYS: '36501' })).toThrow(
      "JOB_DEAD_RETENTION_DAYS must be a whole number from 1 to 36500, got '36501'",
    );
    expect(
      resolveJobSettings({ JOB_SUCCEEDED_RETENTION_DAYS: '36500' }).succeededRetentionDays,
    ).toBe(36_500);
  });

  it('accepts the largest timer delay', () => {
    expect(resolveJobSettings({ JOB_HEAVY_TIMEOUT_MS: '2147483647' }).timeoutMs.heavy).toBe(
      2_147_483_647,
    );
  });

  it('runs only the listed pools, once each', () => {
    expect(resolveJobSettings({ JOB_POOLS: 'heavy' }).pools).toEqual(['heavy']);
    expect(resolveJobSettings({ JOB_POOLS: ' light , light ' }).pools).toEqual(['light']);
  });

  it('stops on an unknown pool', () => {
    expect(() => resolveJobSettings({ JOB_POOLS: 'light,bulk' })).toThrow(
      'JOB_POOLS has unknown pools: bulk',
    );
  });
});

describe('env.getSubmissionExportActiveLimit', () => {
  const saved = process.env.SUBMISSION_EXPORT_ACTIVE_LIMIT;
  afterEach(() => {
    if (saved === undefined) delete process.env.SUBMISSION_EXPORT_ACTIVE_LIMIT;
    else process.env.SUBMISSION_EXPORT_ACTIVE_LIMIT = saved;
  });

  it('is 2 per form unless set', () => {
    delete process.env.SUBMISSION_EXPORT_ACTIVE_LIMIT;
    expect(env.getSubmissionExportActiveLimit()).toBe(2);
    process.env.SUBMISSION_EXPORT_ACTIVE_LIMIT = '5';
    expect(env.getSubmissionExportActiveLimit()).toBe(5);
  });

  it('refuses 0 rather than read it as the default', () => {
    process.env.SUBMISSION_EXPORT_ACTIVE_LIMIT = '0';
    expect(() => env.getSubmissionExportActiveLimit()).toThrow(
      "SUBMISSION_EXPORT_ACTIVE_LIMIT must be a whole number from 1 to 2147483647, got '0'",
    );
  });
});

describe('resolveShutdownSettings', () => {
  it('uses the defaults when nothing is set', () => {
    expect(resolveShutdownSettings({})).toEqual({ delayMs: 5_000, timeoutMs: 28_000 });
  });

  it('allows no delay but requires a timeout', () => {
    expect(resolveShutdownSettings({ SHUTDOWN_DELAY_MS: '0' }).delayMs).toBe(0);
    expect(() => resolveShutdownSettings({ SHUTDOWN_TIMEOUT_MS: '0' })).toThrow(
      "SHUTDOWN_TIMEOUT_MS must be a whole number from 1 to 2147483647, got '0'",
    );
  });
});
