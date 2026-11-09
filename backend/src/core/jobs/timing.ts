import { randomInt } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { MAX_TIMER_MS } from '../config/env';

/** Retry delay after `attempt` (1-based): the base, doubled for each earlier attempt, capped. */
export const backoffDelayMs = (
  attempt: number,
  { backoffBaseMs, backoffMaxMs }: { backoffBaseMs: number; backoffMaxMs: number },
): number => Math.min(backoffBaseMs * 2 ** Math.max(attempt - 1, 0), backoffMaxMs);

/**
 * `ms` moved by up to a fifth either way, so pods started together do not poll together. Never past
 * the largest timer delay.
 */
export const jitteredMs = (ms: number, random: (max: number) => number = randomInt): number => {
  const spread = Math.floor(ms / 5);
  return Math.min(ms - spread + random(2 * spread + 1), MAX_TIMER_MS);
};

/** Runs `write`, trying again up to `retries` times, `delayMs` apart, while it throws. */
export const withRetries = async <T>(
  write: () => Promise<T>,
  retries: number,
  delayMs: number,
): Promise<T> => {
  try {
    return await write();
  } catch (err) {
    if (retries < 1) throw err;
    await delay(delayMs);
    return withRetries(write, retries - 1, delayMs);
  }
};
