import { FormioCommunityEditionAPIv5Client } from '../../../src/plugins/formio-v5/formioV5Client';

/** Covers admin JWT 440 refresh: the client clears its token, re-logs in once, and retries. */
describe('FormioCommunityEditionAPIv5Client 440 recovery', () => {
  const baseUrl = 'http://formio.test';
  const origFetch = global.fetch;

  afterEach(() => {
    global.fetch = origFetch;
    jest.restoreAllMocks();
  });

  it('re-logs in and retries once when admin JWT returns 440', async () => {
    const client = new FormioCommunityEditionAPIv5Client({
      baseUrl,
      username: 'admin@test',
      password: 'secret',
    });
    (client as unknown as { token: string | null }).token = 'stale-jwt';

    const loginHeaders = new Headers();
    loginHeaders.set('x-jwt-token', 'fresh-jwt');

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 440,
        text: () => Promise.resolve('Token expired'),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: loginHeaders,
        text: () => Promise.resolve(''),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify([{ _id: 'form1', title: 'One' }])),
      } as Response);

    const forms = await client.loadForms();
    expect(forms).toEqual([{ _id: 'form1', title: 'One' }]);

    expect(jest.mocked(global.fetch)).toHaveBeenCalledTimes(3);
    const urls = jest.mocked(global.fetch).mock.calls.map((c) => String(c[0]));
    expect(urls[0]).toBe(`${baseUrl}/form`);
    expect(urls[1]).toBe(`${baseUrl}/admin/login`);
    expect(urls[2]).toBe(`${baseUrl}/form`);
  });

  it('fails after one re-login when the retry is also refused with 440', async () => {
    const client = new FormioCommunityEditionAPIv5Client({
      baseUrl,
      username: 'admin@test',
      password: 'secret',
    });
    (client as unknown as { token: string | null }).token = 'stale-jwt';

    const loginHeaders = new Headers();
    loginHeaders.set('x-jwt-token', 'fresh-jwt');
    const expired = {
      ok: false,
      status: 440,
      text: () => Promise.resolve('Token expired'),
    } as Response;

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(expired)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: loginHeaders,
        text: () => Promise.resolve(''),
      } as Response)
      .mockResolvedValueOnce(expired);

    await expect(client.loadForms()).rejects.toMatchObject({ status: 440 });
    expect(jest.mocked(global.fetch)).toHaveBeenCalledTimes(3);
  });
});
