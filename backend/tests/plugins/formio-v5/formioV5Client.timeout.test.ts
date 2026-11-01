import http from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { FormioCommunityEditionAPIv5Client } from '../../../src/plugins/formio-v5/formioV5Client';

// Accepts every connection and never answers, like a Form.io that has hung.
const server = http.createServer(() => undefined);
const sockets = new Set<Socket>();
let baseUrl = '';

beforeAll(async () => {
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const socket of sockets) socket.destroy();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const client = (timeoutMs: number) =>
  new FormioCommunityEditionAPIv5Client({
    baseUrl,
    username: 'admin@test',
    password: 'secret',
    timeoutMs,
  });

type Call = (c: FormioCommunityEditionAPIv5Client, signal: AbortSignal) => Promise<unknown>;

describe('FormioCommunityEditionAPIv5Client against a Form.io that never answers', () => {
  it('gives up on a request within its budget', async () => {
    const started = Date.now();
    await expect(client(200).loadForms()).rejects.toThrow('Formio GET request timed out');
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('gives up on a login within its budget', async () => {
    const started = Date.now();
    await expect(client(200).login()).rejects.toThrow('Formio login timed out');
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it.each<[string, Call, string]>([
    ['saveForm', (c, signal) => c.saveForm({ title: 'Form' }, signal), 'POST'],
    ['loadSubmissions', (c, signal) => c.loadSubmissions('form-1', undefined, signal), 'GET'],
  ])(
    "%s stops when the caller's signal fires, before its own budget",
    async (_name, call, method) => {
      const started = Date.now();
      await expect(call(client(30_000), AbortSignal.timeout(200))).rejects.toThrow(
        `Formio ${method} request timed out`,
      );
      expect(Date.now() - started).toBeLessThan(2000);
    },
  );
});
