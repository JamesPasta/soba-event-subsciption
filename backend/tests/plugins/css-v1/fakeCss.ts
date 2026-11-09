import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

/** What the fake answers a lookup with; 'stall' never answers. */
export type CssAnswer = { status: number; body?: string } | 'stall';

export interface FakeCss {
  /** Origin; the API is under /api/v1 and the token endpoint at /token. */
  origin: string;
  requests: { path: string; query: URLSearchParams; authorization?: string }[];
  /** Replaces how lookups are answered. Token requests always succeed. */
  answer: (respond: () => CssAnswer) => void;
  close: () => Promise<void>;
}

export const json = (value: unknown): CssAnswer => ({ status: 200, body: JSON.stringify(value) });

/** Stands in for CSS: the token endpoint, then the user lookups. Records what each request carried. */
export async function startCss(): Promise<FakeCss> {
  const requests: FakeCss['requests'] = [];
  let respond: () => CssAnswer = () => json({ data: [] });
  const server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://css.test');
    requests.push({
      path: url.pathname,
      query: url.searchParams,
      authorization: req.headers.authorization,
    });
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname === '/token') {
      const issued = requests.filter(({ path }) => path === '/token').length;
      res.end(JSON.stringify({ access_token: `token-${issued}`, expires_in: 3600 }));
      return;
    }
    const answer = respond();
    if (answer === 'stall') return;
    res.statusCode = answer.status;
    res.end(answer.body ?? '');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    requests,
    answer: (next) => {
      respond = next;
    },
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
