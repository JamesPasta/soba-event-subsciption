import { ApiErrorCodes } from '@soba/lib';
import { AppError, ServiceUnavailableError, UnprocessableEntityError } from '../../core/errors';
import { upstreamStatusOf } from '../../core/http/httpErrorMapper';
import { log } from '../../core/logging';

export const TEMPLATE_NOT_RENDERED = 'Template could not be rendered';
const GENERATION_UNAVAILABLE = 'Document generation is unavailable';

/**
 * The error a render failure returns to the caller. A request the backend refused (400, 415 or 422,
 * or an upstream 413) is a generic 422; any other failure is a generic 503.
 */
export function toRenderError(
  err: unknown,
  context: { code: string; templateId: string },
): AppError {
  if (!(err instanceof AppError)) {
    log.error(
      { ...context, err },
      'document generation backend failed (config or unexpected error)',
    );
    return new ServiceUnavailableError(GENERATION_UNAVAILABLE, ApiErrorCodes.render_unavailable);
  }
  // PI-safe: log statuses and the error class only, never the backend's message, which can carry
  // its response body.
  const failure = {
    ...context,
    status: err.statusCode,
    upstreamStatus: upstreamStatusOf(err),
    error: err.name,
  };
  // A backend that refuses the request as too large is refusing this template, not failing.
  if (err.statusCode >= 500 && failure.upstreamStatus !== 413) {
    log.warn(failure, 'document generation backend failed');
    return new ServiceUnavailableError(GENERATION_UNAVAILABLE, ApiErrorCodes.render_unavailable);
  }
  log.warn(failure, 'document generation backend refused the render');
  return new UnprocessableEntityError(TEMPLATE_NOT_RENDERED, ApiErrorCodes.render_failed);
}
