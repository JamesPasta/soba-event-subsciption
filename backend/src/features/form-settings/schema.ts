import { extendZodWithOpenApi, type OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z, type ZodTypeAny } from 'zod';
import { inheritableSettingsSchemas } from '@soba/lib';
import type { SettingsScope } from './routes';

extendZodWithOpenApi(z);

export const FormSettingsParamsSchema = z
  .object({
    id: z.string().min(1),
  })
  .openapi('FormSettings_FormIdParams');

export const WorkspaceSettingsParamsSchema = z
  .object({
    id: z.string().min(1),
  })
  .openapi('FormSettings_WorkspaceIdParams');

const TAG = 'core.form-settings';

const SCOPE_DOCS: Record<
  SettingsScope,
  {
    path: string;
    params: typeof FormSettingsParamsSchema;
    owner: string;
    read403: string;
    write403: string;
    notFound: string;
  }
> = {
  form: {
    path: '/design/forms/{id}/settings',
    params: FormSettingsParamsSchema,
    owner: "The form's",
    read403: 'Requires form_read',
    write403: 'Requires form_update',
    notFound: 'Form not found, or its settings are not available',
  },
  workspace: {
    path: '/workspaces/{id}/settings',
    params: WorkspaceSettingsParamsSchema,
    owner: "The workspace's",
    read403: 'Actor is not a member of the workspace',
    write403: 'Workspace management requires an owner or admin role',
    notFound: 'Workspace not found, or its settings are not available',
  },
};

/** OpenAPI for a settings group's standard GET and PUT at one scope. */
export const registerSettingsPaths = (
  registry: OpenAPIRegistry,
  input: {
    key: string;
    label: string;
    settingsSchema: ZodTypeAny;
    bodySchema: ZodTypeAny;
    scope?: SettingsScope;
  },
): void => {
  const docs = SCOPE_DOCS[input.scope ?? 'form'];
  const path = `${docs.path}/${input.key}`;

  registry.registerPath({
    method: 'get',
    path,
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: { params: docs.params },
    responses: {
      200: {
        description: `${docs.owner} ${input.label}`,
        content: { 'application/json': { schema: input.settingsSchema } },
      },
      403: { description: docs.read403 },
      404: { description: docs.notFound },
    },
  });

  registry.registerPath({
    method: 'put',
    path,
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: {
      params: docs.params,
      body: { content: { 'application/json': { schema: input.bodySchema } } },
    },
    responses: {
      200: {
        description: `Updated ${input.label}`,
        content: { 'application/json': { schema: input.settingsSchema } },
      },
      400: { description: 'Validation or business rule error' },
      403: { description: docs.write403 },
      404: { description: docs.notFound },
      409: { description: 'The settings changed after the version this save names' },
    },
  });
};

/**
 * The OpenAPI schemas of a shared group, built on its named values component so the form's view and
 * save body reference that component rather than repeat it.
 */
export const inheritableOpenApiSchemas = <T extends z.ZodType>(values: T, name: string) => {
  const named = values.clone().openapi(`FormSettings_${name}`);
  const schemas = inheritableSettingsSchemas(named);
  // The generator cannot mark a ref to a named union nullable, so the description carries it.
  const own = named.nullable().openapi({ description: 'Null while the form inherits.' });
  return {
    workspace: schemas.workspace.openapi(`FormSettings_Workspace${name}`),
    form: schemas.form.extend({ own }).openapi(`FormSettings_Form${name}`),
    formBody: schemas.formBody.openapi(`FormSettings_SetForm${name}Body`),
  };
};

/** OpenAPI for a shared group's GET and PUT at both scopes. */
export const registerInheritableSettingsPaths = (
  registry: OpenAPIRegistry,
  input: { key: string; label: string; schemas: ReturnType<typeof inheritableOpenApiSchemas> },
): void => {
  const { key, label, schemas } = input;
  registerSettingsPaths(registry, {
    key,
    label,
    settingsSchema: schemas.form,
    bodySchema: schemas.formBody,
  });
  registerSettingsPaths(registry, {
    key,
    label,
    settingsSchema: schemas.workspace,
    bodySchema: schemas.workspace,
    scope: 'workspace',
  });
};
