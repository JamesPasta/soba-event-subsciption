import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export type CstarHandler = (req: IncomingMessage, res: ServerResponse) => void;

export interface FakeCstar {
  baseUrl: string;
  requests: { url?: string; authorization?: string }[];
  close: () => Promise<void>;
}

/** Stands in for CSTAR under /api/v1 and records what each request carried. */
export async function startCstar(handler: CstarHandler): Promise<FakeCstar> {
  const requests: FakeCstar['requests'] = [];
  const server = createServer((req, res) => {
    requests.push({ url: req.url, authorization: req.headers.authorization });
    handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}/api/v1`,
    requests,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** Answers every request with `status` and `body` as JSON. */
export const json =
  (status: number, body: unknown): CstarHandler =>
  (_req, res) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
