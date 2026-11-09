import { resolveJobSettings, resolveShutdownSettings } from '../../../src/core/config/env';
import { assertJobShutdownFits } from '../../../src/core/jobs/settings';

describe('assertJobShutdownFits', () => {
  it('accepts the defaults, which leave 8 s of the shutdown timeout to close the server', () => {
    const jobs = resolveJobSettings({});
    const { timeoutMs } = resolveShutdownSettings({});
    expect(timeoutMs - (jobs.drainMs + jobs.abortGraceMs + 3000)).toBe(8000);
    expect(() => assertJobShutdownFits(jobs, timeoutMs)).not.toThrow();
  });

  it('stops startup when drain, grace and outcome writes reach the shutdown timeout', () => {
    const jobs = resolveJobSettings({ JOB_DRAIN_MS: '23000' });
    expect(() => assertJobShutdownFits(jobs, 28_000)).toThrow(
      'JOB_DRAIN_MS + JOB_ABORT_GRACE_MS + 3000 ms of outcome writes is 28000 ms; it must be under SHUTDOWN_TIMEOUT_MS (28000 ms)',
    );
  });
});
