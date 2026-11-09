import type { ApiErrorCode } from '@soba/lib';

/**
 * Typed error hierarchy for the core API.
 * Central error-handling middleware maps these to HTTP status codes.
 */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    /** Why the request failed, for a client to choose its own message; sent with `error`. */
    public readonly code?: ApiErrorCode,
  ) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = 'Not found', code?: ApiErrorCode) {
    super(message, 404, code);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized', code?: ApiErrorCode) {
    super(message, 401, code);
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = 'Forbidden', code?: ApiErrorCode) {
    super(message, 403, code);
  }
}

export class ValidationError extends AppError {
  constructor(message: string = 'Validation failed', code?: ApiErrorCode) {
    super(message, 400, code);
  }
}

export class ConflictError extends AppError {
  constructor(message: string = 'Conflict', code?: ApiErrorCode) {
    super(message, 409, code);
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(message: string = 'Payload too large', code?: ApiErrorCode) {
    super(message, 413, code);
  }
}

export class UnsupportedMediaTypeError extends AppError {
  constructor(message: string = 'Unsupported media type', code?: ApiErrorCode) {
    super(message, 415, code);
  }
}

export class UnprocessableEntityError extends AppError {
  constructor(message: string = 'Unprocessable entity', code?: ApiErrorCode) {
    super(message, 422, code);
  }
}

export class InternalError extends AppError {
  constructor(message: string = 'Internal server error', code?: ApiErrorCode) {
    super(message, 500, code);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message: string = 'Too many requests', code?: ApiErrorCode) {
    super(message, 429, code);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message: string = 'Service unavailable', code?: ApiErrorCode) {
    super(message, 503, code);
  }
}
