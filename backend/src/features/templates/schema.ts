import { extendZodWithOpenApi, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import {
  TemplateIdParamsSchema as LibTemplateIdParamsSchema,
  TemplateListResponseSchema as LibTemplateListSchema,
  TemplateNameBodySchema as LibTemplateNameBodySchema,
  TemplateResponseSchema as LibTemplateSchema,
  TemplateUploadBodySchema as LibTemplateUploadBodySchema,
  TemplatesFormQuerySchema as LibTemplatesFormQuerySchema,
  TemplateVersionQuerySchema as LibTemplateVersionQuerySchema,
} from '@soba/lib';

extendZodWithOpenApi(z);

const TEMPLATES_PATH = '/templates';
const TEMPLATE_PATH = `${TEMPLATES_PATH}/{id}`;
const SECURITY = [{ bearerAuth: [] }];
const NOT_FOUND = { description: 'Not found' };
const FORBIDDEN = { description: 'Insufficient form permissions' };
const INVALID_ID = { description: 'Invalid template id' };

export const TemplateIdParamsSchema =
  LibTemplateIdParamsSchema.clone().openapi('Templates_IdParams');

export const TemplatesFormQuerySchema =
  LibTemplatesFormQuerySchema.clone().openapi('Templates_FormQuery');

export const TemplateVersionQuerySchema = LibTemplateVersionQuerySchema.clone().openapi(
  'Templates_FormVersionQuery',
);

export const TemplateNameBodySchema =
  LibTemplateNameBodySchema.clone().openapi('Templates_NameBody');

export const TemplateUploadBodySchema =
  LibTemplateUploadBodySchema.clone().openapi('Templates_UploadBody');

const TemplateSchema = LibTemplateSchema.clone().openapi('Templates_Template');

const TemplateListSchema = LibTemplateListSchema.clone().openapi('Templates_TemplateList');

const templateResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: TemplateSchema } },
});

const multipartFile = (fields: z.ZodRawShape) => ({
  required: true,
  content: {
    'multipart/form-data': {
      schema: z.object({ file: z.string().openapi({ format: 'binary' }), ...fields }),
    },
  },
});

export function registerTemplatesOpenApi(registry: OpenAPIRegistry) {
  const tags = ['feature.templates'];
  const uploadErrors = {
    400: {
      description:
        'Missing file or type, invalid name, a malformed upload, or a template type not available for the form',
    },
    413: { description: 'File too large' },
    415: { description: 'Not a file type the template type accepts' },
    422: { description: 'File failed virus scan' },
    503: { description: 'Virus scanning unavailable' },
  };

  registry.registerPath({
    method: 'get',
    path: TEMPLATES_PATH,
    tags,
    security: SECURITY,
    request: { query: TemplatesFormQuerySchema },
    responses: {
      200: {
        description: "The templates on the form's versions, newest version first, then by type",
        content: { 'application/json': { schema: TemplateListSchema } },
      },
      403: FORBIDDEN,
      404: NOT_FOUND,
    },
  });

  registry.registerPath({
    method: 'post',
    path: TEMPLATES_PATH,
    tags,
    security: SECURITY,
    request: {
      query: TemplateVersionQuerySchema,
      body: multipartFile(TemplateUploadBodySchema.shape),
    },
    responses: {
      201: templateResponse('Created template'),
      ...uploadErrors,
      403: FORBIDDEN,
      404: NOT_FOUND,
      409: { description: 'The form version already has a template of this type' },
    },
  });

  registry.registerPath({
    method: 'get',
    path: TEMPLATE_PATH,
    tags,
    security: SECURITY,
    request: { params: TemplateIdParamsSchema },
    responses: {
      200: templateResponse('Template'),
      400: INVALID_ID,
      403: FORBIDDEN,
      404: NOT_FOUND,
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${TEMPLATE_PATH}/content`,
    tags,
    security: SECURITY,
    request: { params: TemplateIdParamsSchema },
    responses: {
      200: { description: 'Template file (attachment)', content: {} },
      400: INVALID_ID,
      403: FORBIDDEN,
      404: NOT_FOUND,
      503: { description: 'Template content unavailable' },
    },
  });

  registry.registerPath({
    method: 'put',
    path: `${TEMPLATE_PATH}/content`,
    tags,
    security: SECURITY,
    request: { params: TemplateIdParamsSchema, body: multipartFile({}) },
    responses: {
      200: templateResponse('Template with its replaced file'),
      ...uploadErrors,
      403: FORBIDDEN,
      404: NOT_FOUND,
      409: { description: 'Template changed while the request ran' },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: TEMPLATE_PATH,
    tags,
    security: SECURITY,
    request: {
      params: TemplateIdParamsSchema,
      body: { content: { 'application/json': { schema: TemplateNameBodySchema } } },
    },
    responses: {
      200: templateResponse('Renamed template'),
      400: { description: 'Invalid template id or name' },
      403: FORBIDDEN,
      404: NOT_FOUND,
    },
  });

  registry.registerPath({
    method: 'delete',
    path: TEMPLATE_PATH,
    tags,
    security: SECURITY,
    request: { params: TemplateIdParamsSchema },
    responses: {
      204: { description: 'Deleted' },
      400: INVALID_ID,
      403: FORBIDDEN,
      404: NOT_FOUND,
      409: { description: 'Template changed while the request ran' },
    },
  });
}
