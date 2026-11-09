import {
  httpErrorToAppError,
  postBinaryOrThrow,
  upstreamStatusOf,
} from '../../../src/core/http/httpErrorMapper';
import { HttpClient, HttpClientError } from '../../../src/core/http/httpClient';
import {
  ServiceUnavailableError,
  UnprocessableEntityError,
  UnsupportedMediaTypeError,
  ValidationError,
} from '../../../src/core/errors';

const httpError = (status: number, body = 'detail') =>
  new HttpClientError(status, 'status text', body, 'http://svc.test/x');

describe('httpErrorToAppError', () => {
  it('maps 415 to UnsupportedMediaTypeError', () => {
    expect(httpErrorToAppError(httpError(415), 'CDOGS')).toBeInstanceOf(UnsupportedMediaTypeError);
  });

  it('maps 422 to UnprocessableEntityError', () => {
    expect(httpErrorToAppError(httpError(422), 'CDOGS')).toBeInstanceOf(UnprocessableEntityError);
  });

  it('maps a bad-request 400 to ValidationError', () => {
    expect(httpErrorToAppError(httpError(400), 'CDOGS')).toBeInstanceOf(ValidationError);
  });

  it('maps operational 4xx (401/403/404/429) to ServiceUnavailableError', () => {
    const statuses = [401, 403, 404, 429];
    expect.assertions(statuses.length);
    for (const status of statuses) {
      expect(httpErrorToAppError(httpError(status), 'CDOGS')).toBeInstanceOf(
        ServiceUnavailableError,
      );
    }
  });

  it('maps 5xx to ServiceUnavailableError', () => {
    expect(httpErrorToAppError(httpError(503), 'CDOGS')).toBeInstanceOf(ServiceUnavailableError);
  });

  it.each([400, 415, 422, 429, 502])('keeps upstream status %s on the mapped error', (status) => {
    expect(upstreamStatusOf(httpErrorToAppError(httpError(status), 'CDOGS'))).toBe(status);
  });

  it('has no upstream status for a transport failure', () => {
    expect(
      upstreamStatusOf(httpErrorToAppError(new Error('ECONNREFUSED'), 'CDOGS')),
    ).toBeUndefined();
  });

  it('treats a non-HttpClientError as a transport failure', () => {
    const mapped = httpErrorToAppError(new Error('socket hang up'), 'CDOGS');
    expect(mapped).toBeInstanceOf(ServiceUnavailableError);
    expect(mapped.message).toContain('socket hang up');
  });

  it('bounds an oversized upstream body', () => {
    const mapped = httpErrorToAppError(httpError(400, 'x'.repeat(1000)), 'CDOGS');
    expect(mapped.message.length).toBeLessThan(600);
    expect(mapped.message).toContain('…');
  });
});

describe('postBinaryOrThrow', () => {
  const origFetch = global.fetch;
  afterEach(() => {
    global.fetch = origFetch;
  });

  it('returns the binary response on success', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/pdf' }),
      arrayBuffer: () => Promise.resolve(Uint8Array.from([1, 2]).buffer),
    } as unknown as Response);

    const res = await postBinaryOrThrow(
      new HttpClient({ baseUrl: 'http://svc.test' }),
      '/r',
      {},
      'CDOGS',
    );
    expect(res.data).toEqual(Buffer.from([1, 2]));
  });

  it('maps an HTTP failure to an AppError', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 422,
      statusText: 'x',
      text: () => Promise.resolve('nope'),
    } as unknown as Response);

    await expect(
      postBinaryOrThrow(new HttpClient({ baseUrl: 'http://svc.test' }), '/r', {}, 'CDOGS'),
    ).rejects.toBeInstanceOf(UnprocessableEntityError);
  });
});
