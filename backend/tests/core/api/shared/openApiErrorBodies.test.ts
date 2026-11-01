import { isDeepStrictEqual } from 'node:util';
import { ApiErrorCodes } from '@soba/lib';
import {
  buildOpenApiDocument,
  withErrorBodies,
  withMiddlewareErrors,
  type RegisterOpenApiPaths,
} from '../../../../src/core/api/shared/openapi';
import { registerAccessOpenApi } from '../../../../src/core/api/access/schema';
import { registerAdminOpenApi } from '../../../../src/core/api/admin/schema';
import { registerFormsOpenApi } from '../../../../src/core/api/forms/schema';
import { registerGroupsOpenApi } from '../../../../src/core/api/groups/schema';
import { registerHealthOpenApi } from '../../../../src/core/api/health/schema';
import { registerMeOpenApi } from '../../../../src/core/api/me/schema';
import { registerMembersOpenApi } from '../../../../src/core/api/members/schema';
import { registerMetaOpenApi } from '../../../../src/core/api/meta/schema';
import { registerSubmissionsOpenApi } from '../../../../src/core/api/submissions/schema';
import { registerSubmitOpenApi } from '../../../../src/core/api/submit/schema';
import { registerWorkspacesOpenApi } from '../../../../src/core/api/workspaces/schema';
import { registerDocumentGenerationOpenApi } from '../../../../src/features/document-generation/schema';
import { registerFilesOpenApi } from '../../../../src/features/files/schema';
import { registerFormSettingsOpenApi } from '../../../../src/features/form-settings';
import { registerJobsOpenApi } from '../../../../src/features/jobs/schema';
import { registerSubmissionExportOpenApi } from '../../../../src/features/submission-export/schema';
import { registerTemplatesOpenApi } from '../../../../src/features/templates/schema';

// The same registrations the API index makes.
const REGISTRARS: RegisterOpenApiPaths[] = [
  registerFormsOpenApi,
  registerFormSettingsOpenApi,
  registerSubmissionsOpenApi,
  registerSubmitOpenApi,
  registerGroupsOpenApi,
  registerAccessOpenApi,
  registerMeOpenApi,
  registerJobsOpenApi,
  registerSubmissionExportOpenApi,
  registerMembersOpenApi,
  registerWorkspacesOpenApi,
  registerFilesOpenApi,
  registerDocumentGenerationOpenApi,
  registerTemplatesOpenApi,
  registerMetaOpenApi,
  registerAdminOpenApi,
  registerHealthOpenApi,
];

type Response = { description?: string; content?: Record<string, { schema?: unknown }> };
type Operation = { security?: Record<string, unknown>[]; responses: Record<string, Response> };

const document = buildOpenApiDocument(REGISTRARS);
const errorBody = { $ref: '#/components/schemas/Core_ApiError' };

/** Every declared response, as `METHOD /path status`. */
const responses = (): [string, Response][] =>
  Object.entries(document.paths ?? {}).flatMap(([path, item]) =>
    Object.entries(item as Record<string, { responses?: Record<string, Response> }>).flatMap(
      ([method, operation]) =>
        Object.entries(operation.responses ?? {}).map(
          ([status, response]) =>
            [`${method.toUpperCase()} ${path} ${status}`, response] as [string, Response],
        ),
    ),
  );

describe('OpenAPI error bodies', () => {
  it('describes the error body once, with every code', () => {
    const schema = document.components?.schemas?.Core_ApiError as Record<string, unknown>;
    expect(schema).toMatchObject({ type: 'object', required: ['error'] });
    const properties = schema.properties as Record<string, Record<string, unknown>>;
    expect(properties.error).toEqual({ type: 'string' });
    expect(properties.code.enum).toEqual(Object.values(ApiErrorCodes));
    expect(properties.code.nullable).toBeUndefined();
    expect(properties.details).toMatchObject({ type: 'array' });
  });

  it('gives every error response the error body', () => {
    const errors = responses().filter(([label]) => Number(label.split(' ').pop()) >= 400);
    expect(errors.length).toBeGreaterThan(100);
    const missing = errors
      .filter(([, response]) => !response.content?.['application/json']?.schema)
      .map(([label]) => label);
    expect(missing).toEqual([]);
  });

  it.each([
    ['post', '/submit/submissions/{id}/save', '403'],
    ['get', '/submit/submissions/{id}/fill', '404'],
    ['delete', '/files/{id}', '404'],
  ])('answers %s %s %s with the shared error body', (method, path, status) => {
    const operation = (
      document.paths?.[path] as Record<string, { responses: Record<string, Response> }>
    )[method];
    expect(operation.responses[status].content?.['application/json']?.schema).toEqual(errorBody);
  });

  it('leaves success responses as declared', () => {
    const successes = responses().filter(([label]) => Number(label.split(' ').pop()) < 400);
    const withErrorBody = successes
      .filter(([, response]) =>
        isDeepStrictEqual(response.content?.['application/json']?.schema, errorBody),
      )
      .map(([label]) => label);
    expect(withErrorBody).toEqual([]);
  });
});

/** Every operation, as `METHOD /path`. */
const operations = (): [string, Operation][] =>
  Object.entries(document.paths ?? {}).flatMap(([path, item]) =>
    Object.entries(item as Record<string, Operation>).map(
      ([method, operation]) =>
        [`${method.toUpperCase()} ${path}`, operation] as [string, Operation],
    ),
  );

const acceptsBearer = (operation: Operation) =>
  (operation.security ?? []).some((entry) => 'bearerAuth' in entry);

describe('OpenAPI middleware responses', () => {
  it('declares the rate limit on every operation, with the error body', () => {
    const missing = operations()
      .filter(([, operation]) => !operation.responses['429']?.content)
      .map(([label]) => label);
    expect(missing).toEqual([]);
  });

  it('declares a 401 on exactly the operations that accept a bearer token', () => {
    const wrong = operations()
      .filter(([, operation]) => acceptsBearer(operation) !== '401' in operation.responses)
      .map(([label]) => label);
    expect(wrong).toEqual([]);
    expect(operations().some(([, operation]) => !acceptsBearer(operation))).toBe(true);
  });

  it.each([
    ['optional', [{}, { bearerAuth: [] }], 'Invalid or expired bearer token'],
    ['required', [{ bearerAuth: [] }], 'Missing, invalid or expired bearer token'],
  ])('describes the 401 where a bearer token is %s', (_label, security, description) => {
    const result = withMiddlewareErrors({ paths: { '/x': { get: { security, responses: {} } } } });
    expect((result.paths['/x'] as { get: Operation }).get.responses['401']).toEqual({
      description,
    });
  });

  it('keeps a 401 or 429 an operation declares, and adds no 401 without a bearer', () => {
    const own401 = { description: 'Own 401' };
    const own429 = { description: 'Own 429' };
    const result = withMiddlewareErrors({
      paths: {
        '/own': {
          get: { security: [{ bearerAuth: [] }], responses: { '401': own401, '429': own429 } },
        },
        '/public': { get: { responses: {} } },
      },
    });
    const own = (result.paths['/own'] as { get: Operation }).get.responses;
    expect(own['401']).toBe(own401);
    expect(own['429']).toBe(own429);
    const open = (result.paths['/public'] as { get: Operation }).get.responses;
    expect(open['401']).toBeUndefined();
    expect(open['429']).toEqual({ description: 'Too many requests' });
  });
});

describe('withErrorBodies', () => {
  it('fills only error responses without a body of their own', () => {
    const own = { 'application/json': { schema: { type: 'string' } } };
    const result = withErrorBodies({
      paths: {
        '/x': {
          get: {
            responses: {
              '204': { description: 'Gone' },
              '302': { description: 'Moved' },
              '404': { description: 'Missing' },
              '409': { description: 'Conflict', content: own },
              '500': { $ref: '#/components/responses/Failure' },
            },
          },
        },
      },
    });
    const declared = (result.paths['/x'] as { get: { responses: Record<string, Response> } }).get
      .responses;
    expect(declared['204'].content).toBeUndefined();
    expect(declared['302'].content).toBeUndefined();
    expect(declared['404'].content?.['application/json']?.schema).toEqual(errorBody);
    expect(declared['409'].content).toBe(own);
    expect(declared['500'].content).toBeUndefined();
  });
});
