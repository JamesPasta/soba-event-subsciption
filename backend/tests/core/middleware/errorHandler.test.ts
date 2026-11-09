import type { Request, Response } from 'express';
import { UnauthorizedError } from 'express-jwt';
import { coreErrorHandler, errorToHttpResponse } from '../../../src/core/middleware/errorHandler';
import { HttpClientError } from '../../../src/core/http/httpClient';
import { FormioApiError } from '../../../src/plugins/formio-v5/formioV5Client';
import { AppError, ForbiddenError, NotFoundError, ValidationError } from '../../../src/core/errors';
import { log } from '../../../src/core/logging';

/** A Drizzle-style query error wrapping a pg DatabaseError, with the submitted value in params. */
const queryError = (code: string, extra: Record<string, string> = {}) =>
  Object.assign(new Error('Failed query: insert ... params: jane.doe@example.com'), {
    name: 'DrizzleQueryError',
    params: ['jane.doe@example.com'],
    cause: Object.assign(new Error('pg says no'), { code, severity: 'ERROR', ...extra }),
  });

const respond = () => {
  const res = { headersSent: false, status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res as unknown as Response;
};

describe('errorHandler', () => {
  it('errorToHttpResponse returns statusCode and body for AppError', () => {
    const err = new NotFoundError('Resource missing');
    const result = errorToHttpResponse(err);
    expect(result.statusCode).toBe(404);
    expect(result.body).toEqual({ error: 'Resource missing' });
  });

  it('errorToHttpResponse sends an AppError code with its message, and none when unset', () => {
    expect(errorToHttpResponse(new ForbiddenError('Drafts are off', 'drafts_disabled'))).toEqual({
      statusCode: 403,
      body: { error: 'Drafts are off', code: 'drafts_disabled' },
    });
    expect(Object.keys(errorToHttpResponse(new ForbiddenError('No')).body)).toEqual(['error']);
  });

  it('errorToHttpResponse returns 400 for ValidationError', () => {
    const err = new ValidationError('Invalid input');
    const result = errorToHttpResponse(err);
    expect(result.statusCode).toBe(400);
    expect(result.body.error).toBe('Invalid input');
  });

  it('errorToHttpResponse maps a Postgres unique violation to 409', () => {
    const result = errorToHttpResponse({ code: '23505', message: 'duplicate key' });
    expect(result.statusCode).toBe(409);
    expect(result.body).toEqual({ error: 'Resource already exists', code: 'already_exists' });
  });

  it('errorToHttpResponse maps a unique violation wrapped on the cause chain to 409', () => {
    const wrapped = Object.assign(new Error('query failed'), { cause: { code: '23505' } });
    expect(errorToHttpResponse(wrapped).statusCode).toBe(409);
  });

  it.each(['22P02', '22021', '22P05'])(
    'errorToHttpResponse maps Postgres input error %s on the cause chain to 400',
    (code) => {
      const wrapped = Object.assign(new Error('Failed query: select ... params: engine'), {
        cause: { code },
      });
      expect(errorToHttpResponse(wrapped)).toEqual({
        statusCode: 400,
        body: { error: 'Invalid input', code: 'request_invalid' },
      });
    },
  );

  it('errorToHttpResponse keeps the status of an exposed http-errors 4xx (body-parser)', () => {
    const parseError = Object.assign(new Error('Unexpected token } in JSON'), {
      status: 400,
      expose: true,
    });
    expect(errorToHttpResponse(parseError)).toEqual({
      statusCode: 400,
      body: { error: 'Unexpected token } in JSON', code: 'request_invalid' },
    });
    const tooLarge = Object.assign(new Error('request entity too large'), {
      status: 413,
      expose: true,
    });
    expect(errorToHttpResponse(tooLarge)).toEqual({
      statusCode: 413,
      body: { error: 'request entity too large', code: 'request_too_large' },
    });
  });

  it('errorToHttpResponse keeps 401 for an express-jwt UnauthorizedError', () => {
    const err = new UnauthorizedError('invalid_token', { message: 'jwt malformed' });
    expect(errorToHttpResponse(err)).toEqual({
      statusCode: 401,
      body: { error: 'jwt malformed', code: 'unauthenticated' },
    });
  });

  it('errorToHttpResponse keeps 400 for the URIError Express raises on an undecodable param', () => {
    const err = Object.assign(new URIError("Failed to decode param '%E0%A4%A'"), {
      status: 400,
      statusCode: 400,
    });
    expect(errorToHttpResponse(err)).toEqual({
      statusCode: 400,
      body: { error: "Failed to decode param '%E0%A4%A'", code: 'request_invalid' },
    });
  });

  it.each([
    ['Form.io', new FormioApiError(401, 'Unauthorized', 'http://formio/form')],
    ['outbound HTTP', new HttpClientError(404, 'Not Found', 'no template', 'http://cdogs/render')],
  ])('errorToHttpResponse maps an upstream %s 4xx to a generic 500', (_label, err) => {
    expect(errorToHttpResponse(err)).toEqual({
      statusCode: 500,
      body: { error: 'Internal server error', code: 'internal_error' },
    });
  });

  it('errorToHttpResponse returns 500 and Internal server error for generic Error', () => {
    const result = errorToHttpResponse(new Error('Failed query: select secret from soba.x'));
    expect(result.statusCode).toBe(500);
    expect(result.body.error).toBe('Internal server error');
  });

  it('errorToHttpResponse returns 500 and Internal server error for non-Error throw', () => {
    const result = errorToHttpResponse('string throw');
    expect(result.statusCode).toBe(500);
    expect(result.body.error).toBe('Internal server error');
  });

  it('errorToHttpResponse returns custom statusCode for AppError subclass', () => {
    const err = new AppError('Custom', 418);
    const result = errorToHttpResponse(err);
    expect(result.statusCode).toBe(418);
    expect(result.body.error).toBe('Custom');
  });

  it('coreErrorHandler logs a database 500 by its fields, never its message or parameters', () => {
    const error = jest.spyOn(log, 'error').mockImplementation(() => undefined);
    try {
      const err = queryError('23502', { table: 'file', column: 'filename' });
      coreErrorHandler(err, {} as Request, respond(), jest.fn());
      expect(error).toHaveBeenCalledWith(
        {
          name: 'DrizzleQueryError',
          code: '23502',
          table: 'file',
          column: 'filename',
          constraint: undefined,
        },
        'Unhandled error',
      );
      expect(JSON.stringify(error.mock.calls)).not.toContain('jane.doe');
    } finally {
      error.mockRestore();
    }
  });

  it('coreErrorHandler logs rejected database input by its fields, never its parameters', () => {
    const warn = jest.spyOn(log, 'warn').mockImplementation(() => undefined);
    try {
      coreErrorHandler(queryError('22P02'), {} as Request, respond(), jest.fn());
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'DrizzleQueryError', code: '22P02' }),
        'Database rejected request input',
      );
      expect(JSON.stringify(warn.mock.calls)).not.toContain('jane.doe');
    } finally {
      warn.mockRestore();
    }
  });

  it('coreErrorHandler hands the error on once the response has started streaming', () => {
    const next = jest.fn();
    const res = { headersSent: true, status: jest.fn(), json: jest.fn() };
    const err = new Error('stream failed');
    coreErrorHandler(err, {} as Request, res as unknown as Response, next);
    expect(next).toHaveBeenCalledWith(err);
    expect(res.status).not.toHaveBeenCalled();
  });
});
