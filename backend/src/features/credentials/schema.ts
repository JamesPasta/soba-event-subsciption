import {
  CredentialFieldsSchema as LibCredentialFieldsSchema,
  CredentialMetadataSchema as LibCredentialMetadataSchema,
  CredentialStateSchema as LibCredentialStateSchema,
  CredentialSecretSchema as LibCredentialSecretSchema,
  CREDENTIAL_SORT_FIELDS,
  makeSortEnum,
  type SortLocale,
} from '@soba/lib';
import { extendZodWithOpenApi, type OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import {
  offsetQueryFields,
  rejectedCursorField,
  searchQueryField,
  sortLocaleQueryField,
  OffsetPageSchema,
} from '../../core/api/shared/offsetPagination';
import type { RegisterOpenApiPaths } from '../../core/api/shared/openapi';
import { FormSettingsParamsSchema, WorkspaceSettingsParamsSchema } from '../form-settings/schema';
extendZodWithOpenApi(z);

export const CredentialFieldsSchema = LibCredentialFieldsSchema.clone().openapi(
  'Credentials_CredentialFields',
);
export const CredentialMetadataSchema = LibCredentialMetadataSchema.clone().openapi(
  'Credentials_CredentialMetadata',
);
export const CredentialSortSchema = makeSortEnum(CREDENTIAL_SORT_FIELDS).openapi(
  'Credentials_CredentialSort',
);
export const CredentialStateSchema = LibCredentialStateSchema.extend({
  items: z.array(CredentialMetadataSchema),
  page: OffsetPageSchema,
  sort: CredentialSortSchema,
}).openapi('Credentials_CredentialState');
export const CredentialSecretSchema = LibCredentialSecretSchema.extend({
  credential: CredentialMetadataSchema,
}).openapi('Credentials_CredentialSecret');
export const ListCredentialsQuerySchema = z
  .object({
    ...offsetQueryFields,
    cursor: rejectedCursorField,
    q: searchQueryField,
    sort: CredentialSortSchema.default('createdAt:desc'),
    locale: sortLocaleQueryField,
  })
  .openapi('Credentials_ListCredentialsQuery');
export type CredentialListQuery = Omit<z.infer<typeof ListCredentialsQuerySchema>, 'locale'> & {
  locale: SortLocale;
};

export const CredentialParamsSchema = z.object({ id: z.string().min(1), credentialId: z.uuid() });
export const EmptyCredentialBodySchema = z.strictObject({});

const TAG = 'core.form-settings';
const NOT_FOUND = 'Not found, or the feature is not available';
const KEY_NOT_FOUND = 'Not found, the feature is not available, or the key is not owned here';
const SECRET = 'The API key, returned once; the response must not be cached';
const OPERATION_FAILED =
  'The issuer is unavailable or refused the request, or the outcome is unknown';

interface ScopeDocs {
  path: string;
  params: typeof FormSettingsParamsSchema;
  readForbidden: string;
  writeForbidden: string;
  listDescription: string;
}

const registerScope = (registry: OpenAPIRegistry, docs: ScopeDocs): void => {
  const security = [{ bearerAuth: [] }];
  const keyPath = `${docs.path}/{credentialId}`;
  const keyParams = CredentialParamsSchema;
  const fieldsBody = { content: { 'application/json': { schema: CredentialFieldsSchema } } };
  const secret = { 'application/json': { schema: CredentialSecretSchema } };
  const metadata = { 'application/json': { schema: CredentialMetadataSchema } };
  const invalid = { 400: { description: 'Validation error' } };
  const writeErrors = {
    ...invalid,
    403: { description: docs.writeForbidden },
    404: { description: KEY_NOT_FOUND },
    409: { description: 'Another operation holds the key, or it needs reconciliation' },
    503: { description: OPERATION_FAILED },
  };
  registry.registerPath({
    method: 'get',
    path: docs.path,
    tags: [TAG],
    security,
    request: { params: docs.params, query: ListCredentialsQuerySchema },
    responses: {
      200: {
        description: docs.listDescription,
        content: { 'application/json': { schema: CredentialStateSchema } },
      },
      ...invalid,
      403: { description: docs.readForbidden },
      404: { description: NOT_FOUND },
    },
  });
  registry.registerPath({
    method: 'post',
    path: docs.path,
    tags: [TAG],
    security,
    request: { params: docs.params, body: fieldsBody },
    responses: {
      201: { description: SECRET, content: secret },
      ...writeErrors,
    },
  });
  registry.registerPath({
    method: 'get',
    path: keyPath,
    tags: [TAG],
    security,
    request: { params: keyParams },
    responses: {
      200: { description: "One key's metadata", content: metadata },
      ...invalid,
      403: { description: docs.readForbidden },
      404: { description: KEY_NOT_FOUND },
    },
  });
  registry.registerPath({
    method: 'patch',
    path: keyPath,
    tags: [TAG],
    security,
    request: { params: keyParams, body: fieldsBody },
    responses: {
      200: { description: "The key's metadata after the save", content: metadata },
      ...invalid,
      403: { description: docs.writeForbidden },
      404: { description: KEY_NOT_FOUND },
    },
  });
  registry.registerPath({
    method: 'post',
    path: `${keyPath}/regenerate`,
    tags: [TAG],
    security,
    request: {
      params: keyParams,
      body: { content: { 'application/json': { schema: EmptyCredentialBodySchema } } },
    },
    responses: { 200: { description: SECRET, content: secret }, ...writeErrors },
  });
  registry.registerPath({
    method: 'delete',
    path: keyPath,
    tags: [TAG],
    security,
    request: { params: keyParams },
    responses: {
      204: { description: 'Deleted; the key no longer works' },
      ...writeErrors,
    },
  });
};

export const registerApiKeySettingsOpenApi: RegisterOpenApiPaths = (registry) => {
  registerScope(registry, {
    path: '/design/forms/{id}/settings/api-keys',
    params: FormSettingsParamsSchema,
    readForbidden: 'Requires form_read',
    writeForbidden: 'Requires form_update',
    listDescription: "The workspace's keys, which the form cannot change, and the form's own keys",
  });
  registerScope(registry, {
    path: '/workspaces/{id}/settings/api-keys',
    params: WorkspaceSettingsParamsSchema,
    readForbidden: 'Requires workspace membership',
    writeForbidden: 'Workspace management requires an owner or admin role',
    listDescription: "The workspace's own keys",
  });
};
