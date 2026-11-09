import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { ApiErrorCodeSchema } from '@soba/lib';
import { z } from 'zod';

extendZodWithOpenApi(z);

/** The JSON body of an API error. */
export const ApiErrorSchema = z
  .object({
    error: z.string(),
    code: ApiErrorCodeSchema.optional().openapi({
      description: 'Why the request failed, for a client to choose its own message.',
    }),
    details: z
      .array(z.object({ path: z.string(), message: z.string(), code: z.string() }))
      .optional()
      .openapi({ description: 'What a request validation failure found, field by field.' }),
  })
  .openapi('Core_ApiError');

export const IdParamSchema = z.object({
  id: z.string().min(1),
});

/**
 * Reusable `workspaceId` query field.
 * - Required (no `.optional()`): members list, create routes — enforced by `workspaceFromQuery`.
 * - Optional scope anchor on list/search routes — resolved by `workspaceListScope`.
 */
export const workspaceIdQueryField = z.string().min(1).openapi({
  description:
    'Workspace scope anchor. When provided, the actor must be a member; list results are restricted to this workspace.',
  example: '019ed2f0-e3da-77ed-af09-d238bd4bcf66',
});

/** Optional list/search scope anchor or row filter: a single form by id. */
export const formIdQueryField = z.string().min(1).optional().openapi({
  description:
    'Form scope anchor or row filter. When used as the sole anchor, workspace is derived from the form.',
});

/** Optional list/search scope anchor or row filter: a single form version by id. */
export const formVersionIdQueryField = z.string().min(1).optional().openapi({
  description:
    'Form version scope anchor or row filter. When used as the most specific anchor, workspace is derived from the version.',
});

/** Optional list/search scope anchor or row filter: a single submission by id. */
export const submissionIdQueryField = z.string().min(1).optional().openapi({
  description:
    'Submission scope anchor or row filter. When used as the most specific anchor, workspace is derived from the submission.',
});

/** Require at least one of the given query fields to be present (list/search scope anchors). */
export function requireAtLeastOneQueryField<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
  keys: (keyof T & string)[],
  message?: string,
) {
  return schema.superRefine((data, ctx) => {
    const record = data as Record<string, unknown>;
    if (!keys.some((k) => record[k] != null && record[k] !== '')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: message ?? `At least one of ${keys.join(', ')} is required`,
        path: [keys[0]],
      });
    }
  });
}

/**
 * Query schema for workspace-scoped routes whose only declared query param is `workspaceId`
 * (used to document routes that resolve the workspace from the query but have no other query schema).
 */
export const WorkspaceScopedQuerySchema = z
  .object({
    workspaceId: workspaceIdQueryField,
  })
  .openapi('Core_WorkspaceScopedQuery');
