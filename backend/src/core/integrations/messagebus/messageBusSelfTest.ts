import { v7 as uuidv7 } from 'uuid';
import type { MessageBusAdapter } from './MessageBusAdapter';

const DEFAULT_TIMEOUT_MS = 2000;
const RETRY_INTERVAL_MS = 150;

export interface MessageBusSelfTestResult {
  /** Published a probe and a subscriber received it back. */
  delivered: boolean;
  message?: string;
}

/**
 * Confirm the bus actually delivers, not just that the backend is reachable: subscribe to a unique
 * throwaway topic, publish a probe until a subscriber receives it (or the timeout elapses), then
 * unsubscribe. Redis pub/sub is at-most-once with no buffering for a subscription that isn't live
 * yet, and subscribe is async, so the probe is re-published on an interval until the subscription
 * establishes rather than fired once into a possible gap. Checks readiness first so a down backend
 * fails fast instead of burning the whole timeout. Never throws; any failure -> delivered: false.
 */
export async function messageBusSelfTest(
  adapter: MessageBusAdapter,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<MessageBusSelfTestResult> {
  if (!adapter.subscribe) {
    return { delivered: false, message: 'adapter does not support subscribe' };
  }

  const readiness = (await adapter.readinessCheck?.()) ?? { ok: true };
  if (!readiness.ok) {
    return { delivered: false, message: readiness.message };
  }

  const topic = `__messagebus_selftest__:${uuidv7()}`;
  const probe = uuidv7();
  let received = false;
  let resolveGot!: () => void;
  const got = new Promise<void>((resolve) => (resolveGot = resolve));

  const unsubscribe = adapter.subscribe(topic, (payload) => {
    if (payload.probe === probe) {
      received = true;
      resolveGot();
    }
    return Promise.resolve();
  });

  try {
    const deadline = Date.now() + timeoutMs;
    // Publishes again each interval until delivery or the deadline.
    const publishUntilDelivered = async (): Promise<void> => {
      if (received || Date.now() >= deadline) return;
      await adapter.publish(topic, { probe });
      // Cancelable retry cadence: clear it when delivery wins, so no orphaned timer lingers.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const interval = new Promise<void>(
        (resolve) => (timer = setTimeout(resolve, RETRY_INTERVAL_MS)),
      );
      await Promise.race([got, interval]);
      clearTimeout(timer);
      return publishUntilDelivered();
    };
    await publishUntilDelivered();
    return received
      ? { delivered: true }
      : { delivered: false, message: 'no delivery within timeout' };
  } finally {
    if (typeof unsubscribe === 'function') unsubscribe();
  }
}
