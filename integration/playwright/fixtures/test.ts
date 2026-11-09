import { test as base, type Response } from '@playwright/test';
import { setTimeout } from 'node:timers/promises';

export { expect } from '@playwright/test';

// Leave enough quota for the next test's page bootstrap and settings requests.
const REQUEST_RESERVE = 25;

export const test = base.extend<{ rateLimitCooldown: void }>({
  rateLimitCooldown: [
    async ({ context }, use) => {
      const windows = new Map<string, { remaining: number; resetsAt: number }>();
      const observeResponse = (response: Response) => {
        const url = new URL(response.url());
        if (!url.pathname.includes('/api/v1/')) return;

        const headers = response.headers();
        const rateLimit = headers['ratelimit'] ?? '';
        const remaining = /\bremaining=(\d+)/.exec(rateLimit);
        const reset = /\breset=(\d+)/.exec(rateLimit);
        if (!remaining || !reset) return;

        const key = `${url.origin}:${headers['ratelimit-policy']}`;
        windows.set(key, {
          remaining: Number(remaining[1]),
          resetsAt: Date.now() + Number(reset[1]) * 1000,
        });
      };

      context.on('response', observeResponse);
      try {
        await use();
      } finally {
        context.off('response', observeResponse);
        const resetsAt = Math.max(
          0,
          ...[...windows.values()]
            .filter((window) => window.remaining < REQUEST_RESERVE)
            .map((window) => window.resetsAt),
        );
        const delay = resetsAt + 1000 - Date.now();
        if (delay > 0) {
          console.info(`Waiting ${Math.ceil(delay / 1000)}s for the API rate limit to reset.`);
          await setTimeout(delay);
        }
      }
    },
    { auto: true, timeout: 75_000 },
  ],
});
