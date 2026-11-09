import pinoHttp from 'pino-http';
import rTracer from 'cls-rtracer';
import { v7 as uuidv7 } from 'uuid';
import { log } from './logger';

// User search filters are names, email addresses and guids. Express routes paths without regard to case.
const UNLOGGED_QUERY_PATH = /\/user-search(\/|$)/i;

/** The request URL to log, without the query string on paths whose filters identify people. */
export function urlForLog(url: string | undefined): string | undefined {
  const index = url?.indexOf('?') ?? -1;
  if (!url || index < 0) return url;
  const path = url.slice(0, index);
  return UNLOGGED_QUERY_PATH.test(path) ? path : url;
}

export const httpLogger = pinoHttp({
  logger: log,
  autoLogging: true,
  customLogLevel(_req, res, err) {
    if (err != null || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  genReqId(req, res): string {
    const clsRequestId = rTracer.id();
    const normalizedClsRequestId = clsRequestId != null ? String(clsRequestId) : undefined;
    const headerRequestId = req.headers['x-request-id'];
    const existingHeaderId = Array.isArray(headerRequestId) ? headerRequestId[0] : headerRequestId;
    const existingReqId = typeof req.id === 'string' ? req.id : undefined;
    const requestId: string =
      normalizedClsRequestId ?? existingReqId ?? existingHeaderId ?? uuidv7();

    req.id = requestId;
    if (res.getHeader('X-Request-Id') == null) {
      res.setHeader('X-Request-Id', requestId);
    }

    return requestId;
  },
  customProps(req) {
    return {
      requestId:
        (rTracer.id() as string | undefined) ?? (typeof req.id === 'string' ? req.id : undefined),
    };
  },
  serializers: {
    req(req) {
      return {
        id: req.id,
        method: req.method,
        url: urlForLog(req.url),
        remoteAddress: req.socket?.remoteAddress,
        headers: req.headers,
      };
    },
    res(res) {
      return {
        statusCode: res.statusCode,
        headers: typeof res.getHeaders === 'function' ? res.getHeaders() : undefined,
      };
    },
    err(err) {
      return {
        type: err.name,
        message: err.message,
        stack: err.stack,
      };
    },
  },
});
