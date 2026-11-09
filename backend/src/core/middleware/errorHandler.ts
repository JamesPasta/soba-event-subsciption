import { NextFunction, Request, RequestHandler, Response } from 'express';
import { ApiErrorCodes, type ApiErrorCode } from '@soba/lib';
import { AppError, NotFoundError } from '../errors';
import { log } from '../logging';
import { hasPgCode, PG_UNIQUE_VIOLATION, pgErrorFields } from '../db/pgError';

export interface ErrorHttpResponse {
  statusCode: number;
  body: { error: string; code?: ApiErrorCode };
}

// Text the column type can't hold: invalid text representation (a non-uuid id), and a character the
// database encoding rejects (a NUL in text).
const PG_INVALID_INPUT = ['22P02', '22021', '22P05'];
const INTERNAL_ERROR = 'Internal server error';

/** Codes for the statuses a request rejected before app code runs can carry. */
const CLIENT_ERROR_CODES: Partial<Record<number, ApiErrorCode>> = {
  400: ApiErrorCodes.request_invalid,
  401: ApiErrorCodes.unauthenticated,
  413: ApiErrorCodes.request_too_large,
};

/**
 * The 4xx status of a request rejected before app code runs: http-errors (body-parser) marks it
 * `expose`, express-jwt raises UnauthorizedError, and Express flags an undecodable path param with a
 * URIError. Form.io and outbound HTTP errors also carry a status, but it is the upstream's; left
 * unmapped, they are 500s.
 */
function clientErrorStatus(err: unknown): number | null {
  if (!(err instanceof Error)) return null;
  const { status, expose } = err as Error & { status?: unknown; expose?: unknown };
  if (typeof status !== 'number' || status < 400 || status >= 500) return null;
  const trusted = expose === true || err.name === 'UnauthorizedError' || err instanceof URIError;
  return trusted ? status : null;
}

export function errorToHttpResponse(err: unknown): ErrorHttpResponse {
  if (err instanceof AppError) {
    const body = err.code ? { error: err.message, code: err.code } : { error: err.message };
    return { statusCode: err.statusCode, body };
  }
  // A unique-index violation is a conflict (e.g. a name-uniqueness race), not a server error.
  if (hasPgCode(err, [PG_UNIQUE_VIOLATION])) {
    return {
      statusCode: 409,
      body: { error: 'Resource already exists', code: ApiErrorCodes.already_exists },
    };
  }
  if (hasPgCode(err, PG_INVALID_INPUT)) {
    return {
      statusCode: 400,
      body: { error: 'Invalid input', code: ApiErrorCodes.request_invalid },
    };
  }
  const clientStatus = clientErrorStatus(err);
  if (clientStatus !== null) {
    const code = CLIENT_ERROR_CODES[clientStatus];
    const error = (err as Error).message;
    return { statusCode: clientStatus, body: code ? { error, code } : { error } };
  }
  // Unexpected errors can carry SQL or hostnames, so their detail goes to the log only.
  return { statusCode: 500, body: { error: INTERNAL_ERROR, code: ApiErrorCodes.internal_error } };
}

export const coreErrorHandler = (
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void => {
  // A response already streaming can't be replaced; Express's default handler closes the socket.
  if (res.headersSent) {
    next(err);
    return;
  }
  const { statusCode, body } = errorToHttpResponse(err);
  if (statusCode === 500) {
    log.error(pgErrorFields(err) ?? { err }, 'Unhandled error');
  } else if (hasPgCode(err, PG_INVALID_INPUT)) {
    // A server-side value can cause this too, and a 400 alone leaves no trace.
    log.warn(pgErrorFields(err) ?? {}, 'Database rejected request input');
  }
  res.status(statusCode).json(body);
};

/** A request no route matched is a 404 here; it never reaches a later mount. */
export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new NotFoundError('Not found', ApiErrorCodes.route_not_found));
};
