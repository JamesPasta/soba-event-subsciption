import { describe, it, expect } from 'vitest';
import type { ApiErrorCode } from '@soba/lib';
import { ApiError, parseBlob, parseDownload, parseJson } from '@/src/shared/api/sobaHelpers';
import { apiErrorMessage, classifyDataError } from '@/src/shared/api/dataError';
import { isNetworkError, NetworkError, SessionExpiredError } from '@/src/shared/api/sobaFetch';

const errorResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** The error parseJson throws for a failed response. */
const errorFrom = (response: Response): Promise<unknown> =>
  parseJson(response).then(
    () => {
      throw new Error('expected parseJson to throw');
    },
    (err: unknown) => err,
  );

describe('parseJson', () => {
  it('keeps the server message and a known error code', async () => {
    const err = await errorFrom(
      errorResponse(403, {
        error: 'Drafts are not enabled for this form',
        code: 'drafts_disabled',
      }),
    );
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      message: 'Drafts are not enabled for this form',
      status: 403,
      code: 'drafts_disabled',
    });
  });

  it.each([
    ['an unknown code', { error: 'No', code: 'not_a_code' }],
    ['no code', { error: 'No' }],
  ])('drops %s', async (_label, body) => {
    expect(await errorFrom(errorResponse(403, body))).toMatchObject({ code: undefined });
  });

  it('reports a body cut off mid-read as a NetworkError', async () => {
    const cutOff = new TypeError('network error');
    const response = { ok: true, status: 200, json: () => Promise.reject(cutOff) } as Response;
    const err = await errorFrom(response);
    expect(isNetworkError(err)).toBe(true);
    expect((err as Error).cause).toBe(cutOff);
  });

  it('keeps invalid JSON a SyntaxError', async () => {
    const response = new Response('not json', { status: 200 });
    expect(await errorFrom(response)).toBeInstanceOf(SyntaxError);
  });
});

describe('parseBlob', () => {
  it('reports a body cut off mid-read as a NetworkError', async () => {
    const cutOff = new TypeError('network error');
    const response = { ok: true, status: 200, blob: () => Promise.reject(cutOff) } as Response;
    const err = await parseBlob(response).catch((e: unknown) => e);
    expect(isNetworkError(err)).toBe(true);
    expect((err as Error).cause).toBe(cutOff);
  });

  it('throws a refusal as its ApiError', async () => {
    await expect(parseBlob(errorResponse(403, { error: 'No' }))).rejects.toMatchObject({
      status: 403,
    });
  });
});

describe('classifyDataError', () => {
  it.each([
    ['a request that never reached the server', new NetworkError(new TypeError('x')), 'offline'],
    ['a TypeError from code', new TypeError('x is undefined'), 'failed'],
    ['an ended session', new SessionExpiredError(), 'sessionExpired'],
    ['a refusal', new ApiError('No', 403), 'forbidden'],
    ['a server failure', new ApiError('Internal server error', 500), 'failed'],
  ])('classifies %s', (_label, cause, kind) => {
    expect(classifyDataError(cause).kind).toBe(kind);
  });
});

describe('apiErrorMessage', () => {
  const messages = { drafts_disabled: 'Drafts are off.' } as Record<ApiErrorCode, string>;

  it('picks the message for a coded error', () => {
    const refused = new ApiError('Drafts are not enabled for this form', 403, 'drafts_disabled');
    expect(apiErrorMessage(refused, messages)).toBe('Drafts are off.');
  });

  it.each([
    ['an error without a code', new ApiError('No', 403)],
    ['an error that is not an API error', new Error('boom')],
  ])('is null for %s', (_label, cause) => {
    expect(apiErrorMessage(cause, messages)).toBeNull();
  });

  it.each([
    ['a server failure', new ApiError('Internal server error', 500), 'Try again.'],
    [
      'a request that never reached the server',
      new NetworkError(new TypeError('Failed to fetch')),
      'Try again.',
    ],
    ['an error that is not from the API', new TypeError('x is undefined'), 'Try again.'],
    ['a coded error', new ApiError('No', 403, 'drafts_disabled'), 'Drafts are off.'],
    [
      'a server failure whose code has no message',
      new ApiError('Internal server error', 500, 'internal_error'),
      'Try again.',
    ],
    ['an uncoded client error', new ApiError('Engine says no', 400), null],
    ['a client error whose code has no message', new ApiError('No', 400, 'request_invalid'), null],
    ['an ended session', new SessionExpiredError(), null],
  ])('with a fallback, answers %s', (_label, cause, expected) => {
    expect(apiErrorMessage(cause, messages, 'Try again.')).toBe(expected);
  });
});

describe('parseDownload', () => {
  const fileResponse = (disposition: string | null) =>
    new Response('x', disposition ? { headers: { 'Content-Disposition': disposition } } : {});

  it('names the file from filename*', async () => {
    const file = await parseDownload(
      fileResponse(`attachment; filename="r_sum_.csv"; filename*=UTF-8''r%C3%A9sum%C3%A9.csv`),
    );
    expect(file.filename).toBe('résumé.csv');
    expect(file.blob.size).toBe(1);
  });

  it('falls back to the plain filename, then to a generic name', async () => {
    expect((await parseDownload(fileResponse('attachment; filename="plan.pdf"'))).filename).toBe(
      'plan.pdf',
    );
    expect((await parseDownload(fileResponse('attachment; filename=""'))).filename).toBe(
      'download',
    );
    expect((await parseDownload(fileResponse(null))).filename).toBe('download');
  });

  // Headers as the backend's contentDisposition builds them for these stored names.
  it.each([
    [
      "report; filename*=UTF-8''invoice.exe; .pdf",
      `attachment; filename="report; filename*=UTF-8''invoice.exe; .pdf"; filename*=UTF-8''report%3B%20filename%2A%3DUTF-8%27%27invoice.exe%3B%20.pdf`,
    ],
    [
      "x; filename*=UTF-8''%ZZ; .pdf",
      `attachment; filename="x; filename*=UTF-8''%ZZ; .pdf"; filename*=UTF-8''x%3B%20filename%2A%3DUTF-8%27%27%25ZZ%3B%20.pdf`,
    ],
  ])('names %s from the trailing filename*', async (name, disposition) => {
    expect((await parseDownload(fileResponse(disposition))).filename).toBe(name);
  });

  it('falls back to the plain filename when filename* does not decode', async () => {
    const file = await parseDownload(
      fileResponse(`attachment; filename="plan.pdf"; filename*=UTF-8''%ZZ`),
    );
    expect(file.filename).toBe('plan.pdf');
  });

  it('throws a refused download with its status', async () => {
    await expect(
      parseDownload(errorResponse(404, { error: 'File not found', code: 'file_not_found' })),
    ).rejects.toMatchObject({ status: 404, code: 'file_not_found' });
  });
});
