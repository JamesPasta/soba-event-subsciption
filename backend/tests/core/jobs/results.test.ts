import type { Logger } from 'pino';
import { createProgressReporter } from '../../../src/core/jobs/results';
import type { JobProgress } from '../../../src/core/db/repos/jobRepo';

const log = { warn: jest.fn() } as unknown as Logger;

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('createProgressReporter', () => {
  it('writes at most once per interval and keeps the latest value for the outcome', async () => {
    let clock = 0;
    const written: JobProgress[] = [];
    const reporter = createProgressReporter(
      (progress) => {
        written.push(progress);
        return Promise.resolve(true);
      },
      5_000,
      log,
      () => clock,
    );

    reporter.report(1, 10);
    await settle();
    reporter.report(2, 10);
    clock = 4_999;
    reporter.report(3, 10);
    await settle();
    expect(written).toEqual([{ done: 1, total: 10 }]);

    clock = 5_000;
    reporter.report(4, 10);
    await settle();
    expect(written).toEqual([
      { done: 1, total: 10 },
      { done: 4, total: 10 },
    ]);
    reporter.report(5, 10);
    expect(reporter.latest()).toEqual({ done: 5, total: 10 });
  });

  it('never runs two writes at once', async () => {
    let clock = 0;
    let finish: (held: boolean) => void = () => undefined;
    const write = jest.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    const reporter = createProgressReporter(write, 1_000, log, () => clock);

    reporter.report(1);
    clock = 2_000;
    reporter.report(2);
    expect(write).toHaveBeenCalledTimes(1);
    finish(true);
    await settle();
    reporter.report(3);
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('keeps going when a write fails', async () => {
    let clock = 0;
    const write = jest.fn().mockRejectedValueOnce(new Error('db down')).mockResolvedValue(true);
    const reporter = createProgressReporter(write, 1_000, log, () => clock);

    reporter.report(1);
    await settle();
    expect(log.warn).toHaveBeenCalled();
    clock = 1_000;
    reporter.report(2);
    expect(write).toHaveBeenLastCalledWith({ done: 2, total: null });
  });

  it('stores whole, non-negative counts that fit the column', () => {
    const reporter = createProgressReporter(
      () => Promise.resolve(true),
      1_000,
      log,
      () => 0,
    );
    reporter.report(2.7, -1);
    expect(reporter.latest()).toEqual({ done: 2, total: 0 });
    reporter.report(Number.NaN, 3_000_000_000);
    expect(reporter.latest()).toEqual({ done: 0, total: 2_147_483_647 });
  });
});
