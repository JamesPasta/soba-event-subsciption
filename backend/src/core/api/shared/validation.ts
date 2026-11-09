import { NextFunction, Request, RequestHandler, Response } from 'express';
import { ApiErrorCodes } from '@soba/lib';
import { z, ZodTypeAny } from 'zod';

export type RequestSchemas = {
  body?: ZodTypeAny;
  params?: ZodTypeAny;
  query?: ZodTypeAny;
};

export type ValidationErrorDetail = {
  path: string;
  message: string;
  code: string;
};

const toErrorDetail = (issue: z.ZodIssue): ValidationErrorDetail => ({
  path: issue.path.join('.'),
  message: issue.message,
  code: issue.code,
});

export type ValidationPayload = {
  body?: unknown;
  params?: unknown;
  query?: unknown;
};

export type ValidationResult =
  | { ok: true; data: ValidationPayload }
  | { ok: false; error: string; details: ValidationErrorDetail[] };

export function validateRequestPayload(
  schemas: RequestSchemas,
  payload: ValidationPayload,
): ValidationResult {
  if (schemas.body !== undefined) {
    const result = schemas.body.safeParse(payload.body);
    if (!result.success) {
      return {
        ok: false,
        error: 'Invalid request body',
        details: result.error.issues.map(toErrorDetail),
      };
    }
    payload = { ...payload, body: result.data };
  }
  if (schemas.params !== undefined) {
    const result = schemas.params.safeParse(payload.params);
    if (!result.success) {
      return {
        ok: false,
        error: 'Invalid request params',
        details: result.error.issues.map(toErrorDetail),
      };
    }
    payload = { ...payload, params: result.data };
  }
  if (schemas.query !== undefined) {
    const result = schemas.query.safeParse(payload.query);
    if (!result.success) {
      return {
        ok: false,
        error: 'Invalid request query',
        details: result.error.issues.map(toErrorDetail),
      };
    }
    payload = { ...payload, query: result.data };
  }
  return { ok: true, data: payload };
}

function isValidationFailure(r: ValidationResult): r is Extract<ValidationResult, { ok: false }> {
  return !r.ok;
}

export const validateRequest = (schemas: RequestSchemas): RequestHandler => {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = validateRequestPayload(schemas, {
      body: req.body,
      params: req.params,
      query: req.query,
    });
    if (isValidationFailure(result)) {
      return res.status(400).json({
        error: result.error,
        code: ApiErrorCodes.request_invalid,
        details: result.details,
      });
    }
    if (result.data.body !== undefined) req.body = result.data.body;
    if (result.data.params !== undefined) req.params = result.data.params as Request['params'];
    if (result.data.query !== undefined) {
      // Merge over the original query so cross-cutting params not declared in the route schema
      // (e.g. `workspaceId`, consumed by the workspace-context middleware) survive Zod's
      // default key-stripping. Validated/coerced fields take precedence.
      req.query = {
        ...req.query,
        ...(result.data.query as Record<string, unknown>),
      } as Request['query'];
    }
    next();
  };
};
