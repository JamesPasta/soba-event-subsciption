import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { FormioCommunityEditionAPIv5Client } from '../../../src/plugins/formio-v5/formioV5Client';

// Records each request line and answers every one with an empty JSON object.
const received: string[] = [];
const server = http.createServer((req, res) => {
  received.push(`${req.method} ${req.url}`);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end('{}');
});
let client: FormioCommunityEditionAPIv5Client;

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  client = new FormioCommunityEditionAPIv5Client({
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    username: '',
    password: '',
  });
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  received.length = 0;
});

// Unencoded, this id steps out of /form and starts a query string.
const id = '../role?x=1';
const seg = '..%2Frole%3Fx%3D1';

type Call = (c: FormioCommunityEditionAPIv5Client) => Promise<unknown>;

describe('FormioCommunityEditionAPIv5Client id path segments', () => {
  it.each<[string, Call, string]>([
    ['loadForm', (c) => c.loadForm(id), `GET /form/${seg}`],
    ['saveForm', (c) => c.saveForm({ _id: id }), `PUT /form/${seg}`],
    ['deleteForm', (c) => c.deleteForm(id), `DELETE /form/${seg}`],
    ['loadSubmissions', (c) => c.loadSubmissions(id), `GET /form/${seg}/submission`],
    ['loadSubmission', (c) => c.loadSubmission(id, id), `GET /form/${seg}/submission/${seg}`],
    ['saveSubmission create', (c) => c.saveSubmission(id, {}), `POST /form/${seg}/submission`],
    [
      'saveSubmission update',
      (c) => c.saveSubmission(id, { _id: id }),
      `PUT /form/${seg}/submission/${seg}`,
    ],
    [
      'deleteSubmission',
      (c) => c.deleteSubmission(id, id),
      `DELETE /form/${seg}/submission/${seg}`,
    ],
  ])('%s sends each id as one encoded segment', async (_name, call, expected) => {
    await call(client);
    expect(received).toEqual([expected]);
  });

  it.each(['', '.', '..'])('refuses the id %p without a request', async (bad) => {
    await expect(client.loadForm(bad)).rejects.toThrow('Formio id is not a valid path segment');
    expect(received).toEqual([]);
  });
});
