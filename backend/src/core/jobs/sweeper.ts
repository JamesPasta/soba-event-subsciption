import type { Logger } from 'pino';
import type { JobSettings } from '../config/env';
import { sweepJobResults, sweepJobs } from '../db/repos/jobRepo';
import { mapInOrder } from '../inOrder';
import { fileStore } from '../services/fileStore';
import { jitteredMs } from './timing';

/**
 * Periodically requeues jobs whose worker died, removes result files that expired or belong to jobs
 * that did not succeed, and deletes finished jobs past retention.
 */
export class JobSweeper {
  private timer?: NodeJS.Timeout;
  private sweeping: Promise<void> = Promise.resolve();
  private stopped = false;

  constructor(
    private readonly settings: JobSettings,
    private readonly log: Logger,
  ) {}

  /** Call outside any request: the sweep timers keep the context they start in. */
  start(): void {
    this.schedule();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.sweeping;
  }

  private schedule(): void {
    this.timer = setTimeout(() => {
      this.sweeping = this.sweep();
    }, jitteredMs(this.settings.sweepIntervalMs));
  }

  private async sweep(): Promise<void> {
    try {
      const result = await sweepJobs(this.settings);
      if (Object.values(result).some((count) => count > 0)) this.log.info(result, 'Job sweep');
      await this.sweepResults();
    } catch (err) {
      this.log.error({ err }, 'Job sweep failed');
    }
    if (!this.stopped) this.schedule();
  }

  /**
   * Rows go first, then their bytes one at a time. Not started once shutdown begins; a batch whose
   * rows are gone has its bytes deleted, as nothing would find them later.
   */
  private async sweepResults(): Promise<void> {
    if (this.stopped) return;
    const removed = await sweepJobResults(this.settings.resultSweepBatch);
    if (removed.length === 0) return;
    await mapInOrder(removed, (file) => fileStore.deleteBytes(file));
    this.log.info({ results: removed.length }, 'Job results removed');
  }
}
