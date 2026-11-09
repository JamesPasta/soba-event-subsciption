import {
  extendZodWithOpenApi,
  OpenApiGeneratorV3,
  OpenAPIRegistry,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import type { Router } from 'express';
import { env } from '../../config/env';
import { ApiErrorSchema } from './schema';

extendZodWithOpenApi(z);

export type RegisterOpenApiPaths = (registry: OpenAPIRegistry) => void;

/** Domain module contract for core API: router mounted at path + OpenAPI registration */
export interface CoreDomain {
  path: string;
  router: Router;
  registerOpenApi: RegisterOpenApiPaths;
}

const openApiPathRegistrars: RegisterOpenApiPaths[] = [];

export const registerOpenApiPaths = (registrar: RegisterOpenApiPaths): void => {
  openApiPathRegistrars.push(registrar);
};

type ResponseLike = { $ref?: string; content?: unknown; description?: string };
type OperationLike = {
  security?: Record<string, unknown>[];
  responses?: Record<string, ResponseLike>;
};

const operationsOf = (document: { paths?: Record<string, unknown> }): OperationLike[] =>
  Object.values(document.paths ?? {})
    .flatMap((pathItem) => Object.values(pathItem as Record<string, unknown>))
    .filter((value): value is OperationLike => typeof value === 'object' && value !== null)
    .filter((operation) => 'responses' in operation);

const responsesOf = (document: { paths?: Record<string, unknown> }) =>
  operationsOf(document).flatMap((operation) => Object.entries(operation.responses ?? {}));

/**
 * Adds the responses middleware sends on every operation it covers, unless the operation declares
 * them: 429 from the rate limiter on every request, and 401 where a bearer token is accepted.
 */
export const withMiddlewareErrors = <T extends { paths?: Record<string, unknown> }>(
  document: T,
): T => {
  for (const operation of operationsOf(document)) {
    const responses = (operation.responses ??= {});
    responses['429'] ??= { description: 'Too many requests' };
    const security = operation.security ?? [];
    if (security.some((entry) => 'bearerAuth' in entry)) {
      const optional = security.some((entry) => Object.keys(entry).length === 0);
      responses['401'] ??= {
        description: optional
          ? 'Invalid or expired bearer token'
          : 'Missing, invalid or expired bearer token',
      };
    }
  }
  return document;
};

/** Gives every 4xx and 5xx response that declares no body of its own the shared error body. */
export const withErrorBodies = <T extends { paths?: Record<string, unknown> }>(document: T): T => {
  for (const [status, response] of responsesOf(document)) {
    if (Number(status) >= 400 && !response.$ref && !response.content) {
      response.content = {
        'application/json': { schema: { $ref: '#/components/schemas/Core_ApiError' } },
      };
    }
  }
  return document;
};

/** The spec for the given path registrations, with the shared error body on every error response. */
export const buildOpenApiDocument = (registrars: readonly RegisterOpenApiPaths[]) => {
  const registry = new OpenAPIRegistry();
  registry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
  });
  registry.register('Core_ApiError', ApiErrorSchema);

  for (const registrar of registrars) {
    registrar(registry);
  }

  const generator = new OpenApiGeneratorV3(registry.definitions);
  const document = generator.generateDocument({
    openapi: '3.0.3',
    info: {
      title: 'Soba Backend API',
      version: '1.0.0',
      description: 'Core and plugin APIs for Soba backend.',
    },
    servers: [
      {
        url: `${env.getApiBasePath()}/api/v1`,
        description: 'Core API v1',
      },
    ],
  });
  return withErrorBodies(withMiddlewareErrors(document));
};

export const buildOpenApiSpec = () => buildOpenApiDocument(openApiPathRegistrars);
