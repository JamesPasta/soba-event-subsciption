import { AsyncLocalStorage } from 'node:async_hooks';
import rTracer from 'cls-rtracer';
import type { Logger } from 'pino';
import type { JobPoolCode, JobSettings } from '../config/env';
import {
  claimJobs,
  finishJob,
  heartbeatJob,
  releaseJob,
  writeJobProgress,
  type ClaimedJob,
  type JobProgress,
} from '../db/repos/jobRepo';
import type { JobRegistry } from './registry';
import { createProgressReporter, storeJobResult } from './results';
import { OUTCOME_WRITE_RETRIES, OUTCOME_WRITE_RETRY_MS } from './settings';
import {
  decideOutcome,
  errorText,
  JobCancelledError,
  JobFailedError,
  type JobOutcome,
  type JobStopReason,
} from './settlement';
import { jitteredMs, withRetries } from './timing';

interface RunningJob {
  job: ClaimedJob;
  controller: AbortController;
  stopReason?: JobStopReason;
  /** The handler threw `JobFailedError`: no further attempts. */
  permanent: boolean;
  /** The handler has returned; only the outcome write is left. */
  returned: boolean;
  stopHeartbeat: () => void;
  /** Stops the heartbeat when an aborted handler has not returned within the grace. */
  abandonTimer?: NodeJS.Timeout;
  done: Promise<void>;
}

interface PoolState {
  pool: JobPoolCode;
  types: string[];
  running: Map<string, RunningJob>;
  timer?: NodeJS.Timeout;
  claiming: Promise<void>;
  /** Set while a claim is in flight; a nudge then claims again straight after. */
  inFlight: boolean;
  nudged: boolean;
}

/** True when `promise` settles within `ms`. */
const settlesWithin = async (promise: Promise<unknown>, ms: number): Promise<boolean> => {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  try {
    return await Promise.race([promise.then(() => true), timeout]);
  } finally {
    clearTimeout(timer);
  }
};

const recordOutcome = (
  job: ClaimedJob,
  outcome: JobOutcome,
  progress: JobProgress | undefined,
): Promise<boolean> =>
  outcome.kind === 'release'
    ? releaseJob(job.id, job.claimToken)
    : finishJob(job.id, job.claimToken, outcome, progress);

const OUTCOME_MESSAGES: Record<JobOutcome['kind'], string> = {
  succeeded: 'Job succeeded',
  retry: 'Job failed; retry scheduled',
  dead: 'Job dead',
  cancelled: 'Job cancelled',
  release: 'Job released for another pod',
};

/**
 * Runs queued jobs for the pools this pod is configured for. Each pool polls on its own interval and
 * runs up to its concurrency at once; a held job's lease is extended every third of the lease.
 */
export class JobRunner {
  private readonly pools = new Map<JobPoolCode, PoolState>();
  private stopping = false;
  /** Runs a callback in the context `start` was called in, so timers set during a request do not
   *  carry its request id into later polls. */
  private outsideRequests: <R>(fn: () => R) => R = (fn) => fn();

  constructor(
    private readonly registry: JobRegistry,
    private readonly settings: JobSettings,
    private readonly log: Logger,
  ) {}

  start(): void {
    this.outsideRequests = AsyncLocalStorage.snapshot();
    for (const pool of this.settings.pools) {
      const types = this.registry.typesIn(pool);
      if (types.length === 0) continue;
      const state: PoolState = {
        pool,
        types,
        running: new Map(),
        claiming: Promise.resolve(),
        inFlight: false,
        nudged: false,
      };
      this.pools.set(pool, state);
      this.schedule(state, jitteredMs(this.settings.pollMs[pool]));
    }
    this.log.info({ pools: [...this.pools.keys()] }, 'Job runner started');
  }

  /** Claim now rather than at the next poll. Does nothing when this pod does not run the pool. */
  nudge(pool: JobPoolCode): void {
    const state = this.pools.get(pool);
    if (!state || this.stopping) return;
    if (state.inFlight) {
      state.nudged = true;
      return;
    }
    this.schedule(state, 0);
  }

  /**
   * Stop claiming and wait up to the drain deadline for running jobs. Jobs still running then are
   * aborted; each is released once its handler returns. Jobs whose handler has returned get the
   * outcome write's retries. A handler that does not return within the grace keeps its job until the
   * lease expires and the sweeper takes it.
   */
  async stop(): Promise<void> {
    this.stopping = true;
    const states = [...this.pools.values()];
    for (const state of states) clearTimeout(state.timer);
    await Promise.all(states.map((state) => state.claiming));
    const running = () => states.flatMap((state) => [...state.running.values()]);
    const done = (entries: RunningJob[]) => Promise.all(entries.map((entry) => entry.done));
    if (running().length === 0) return;
    this.log.info({ running: running().length }, 'Job runner draining');
    if (await settlesWithin(done(running()), this.settings.drainMs)) return;
    for (const entry of running()) this.abort(entry, 'drain');
    if (await settlesWithin(done(running()), this.settings.abortGraceMs)) return;
    const writing = running().filter((entry) => entry.returned);
    await settlesWithin(done(writing), OUTCOME_WRITE_RETRIES * OUTCOME_WRITE_RETRY_MS);
    if (running().length === 0) return;
    this.log.warn(
      { running: running().map((entry) => entry.job.id) },
      'Job runner stopped with handlers still running; their leases will expire',
    );
  }

  private schedule(state: PoolState, delayMs: number): void {
    clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      this.outsideRequests(() => {
        state.claiming = this.claim(state);
      });
    }, delayMs);
  }

  private async claim(state: PoolState): Promise<void> {
    if (this.stopping) return;
    state.inFlight = true;
    state.nudged = false;
    const free = this.settings.concurrency[state.pool] - state.running.size;
    try {
      if (free > 0) {
        const claimed = await claimJobs(state.types, free, this.settings.leaseMs[state.pool]);
        for (const job of claimed) this.run(state, job);
      }
    } catch (err) {
      this.log.error({ err, pool: state.pool }, 'Job claim failed');
    } finally {
      state.inFlight = false;
    }
    if (this.stopping) return;
    this.schedule(state, state.nudged ? 0 : jitteredMs(this.settings.pollMs[state.pool]));
  }

  private run(state: PoolState, job: ClaimedJob): void {
    const entry: RunningJob = {
      job,
      controller: new AbortController(),
      permanent: false,
      returned: false,
      stopHeartbeat: () => undefined,
      done: Promise.resolve(),
    };
    state.running.set(job.id, entry);
    entry.done = rTracer
      .runWithId(() => this.execute(state, entry), job.id)
      .catch((err: unknown) => {
        this.log.error({ err, jobId: job.id }, 'Job outcome not recorded; its lease will expire');
      })
      .finally(() => {
        state.running.delete(job.id);
        this.nudge(state.pool);
      });
  }

  private async execute(state: PoolState, entry: RunningJob): Promise<void> {
    const { job } = entry;
    const log = this.log.child({ jobId: job.id, jobType: job.type, attempt: job.attempts });
    entry.stopHeartbeat = this.startHeartbeat(state, entry, log);
    const progress = createProgressReporter(
      (value) => writeJobProgress(job.id, job.claimToken, value),
      this.settings.progressIntervalMs,
      log,
    );
    try {
      log.info('Job started');
      const error = await this.runHandler(state, entry, log, progress.report);
      entry.returned = true;
      clearTimeout(entry.abandonTimer);
      const outcome = decideOutcome(error, entry.stopReason, job, this.settings, entry.permanent);
      if (!outcome) {
        log.warn({ reason: entry.stopReason, error }, 'Job stopped before finishing');
        return;
      }
      // The heartbeat keeps the lease while the outcome is written.
      const recorded = await withRetries(
        () => recordOutcome(job, outcome, progress.latest()),
        OUTCOME_WRITE_RETRIES,
        OUTCOME_WRITE_RETRY_MS,
      );
      if (recorded) {
        const expected = outcome.kind === 'succeeded' || outcome.kind === 'release';
        log[expected ? 'info' : 'warn']({ outcome }, OUTCOME_MESSAGES[outcome.kind]);
      } else {
        log.warn({ outcome: outcome.kind }, 'Job was no longer held; outcome not recorded');
      }
    } finally {
      clearTimeout(entry.abandonTimer);
      entry.stopHeartbeat();
    }
  }

  /** Runs the handler under its timeout. Resolves to the error text when it failed. */
  private async runHandler(
    state: PoolState,
    entry: RunningJob,
    log: Logger,
    reportProgress: (done: number, total?: number | null) => void,
  ): Promise<string | undefined> {
    const { job, controller } = entry;
    let timeoutMs = this.settings.timeoutMs[state.pool];
    let timer: NodeJS.Timeout | undefined;
    try {
      const definition = this.registry.require(job.type);
      timeoutMs = definition.timeoutMs ?? timeoutMs;
      timer = setTimeout(() => this.abort(entry, 'timeout'), timeoutMs);
      await definition.run({
        job,
        signal: controller.signal,
        log,
        reportProgress,
        resultMaxBytes: this.settings.resultMaxBytes,
        storeResult: (staged, meta) =>
          storeJobResult(job, staged, meta, this.settings, controller.signal),
      });
      return undefined;
    } catch (err) {
      if (err instanceof JobFailedError) entry.permanent = true;
      if (err instanceof JobCancelledError && !entry.stopReason) entry.stopReason = 'cancel';
      return entry.stopReason === 'timeout' ? `Timed out after ${timeoutMs} ms` : errorText(err);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Extends the lease until stopped; aborts the handler on a cancel request or a lost lease. */
  private startHeartbeat(state: PoolState, entry: RunningJob, log: Logger): () => void {
    const leaseMs = this.settings.leaseMs[state.pool];
    const intervalMs = Math.floor(leaseMs / 3);
    let stopped = false;
    let timer: NodeJS.Timeout | undefined;
    const beat = async (): Promise<void> => {
      let held = true;
      try {
        const status = await heartbeatJob(entry.job.id, entry.job.claimToken, leaseMs);
        held = status.held;
        if (!status.held) this.abort(entry, 'lease_lost');
        else if (status.cancelRequested) this.abort(entry, 'cancel');
      } catch (err) {
        log.warn({ err }, 'Job heartbeat failed');
      }
      if (held && !stopped) timer = setTimeout(() => void beat(), intervalMs);
    };
    timer = setTimeout(() => void beat(), intervalMs);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }

  /**
   * Abort the handler once, for the first reason. Unless the lease is already lost, the heartbeat
   * stops after the grace if the handler has not returned, so its lease expires.
   */
  private abort(entry: RunningJob, reason: JobStopReason): void {
    if (entry.stopReason) return;
    entry.stopReason = reason;
    entry.controller.abort(reason);
    if (reason === 'lease_lost') return;
    entry.abandonTimer = setTimeout(() => entry.stopHeartbeat(), this.settings.abortGraceMs);
  }
}
