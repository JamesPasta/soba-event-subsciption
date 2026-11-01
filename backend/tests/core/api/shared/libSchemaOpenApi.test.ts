import { OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import { registerFormsOpenApi } from '../../../../src/core/api/forms/schema';
import { registerSubmissionsOpenApi } from '../../../../src/core/api/submissions/schema';
import { registerWorkspacesOpenApi } from '../../../../src/core/api/workspaces/schema';
import { registerAdminOpenApi } from '../../../../src/core/api/admin/schema';
import { registerMetaOpenApi } from '../../../../src/core/api/meta/schema';
import { registerMeOpenApi } from '../../../../src/core/api/me/schema';
import { registerSubmitOpenApi } from '../../../../src/core/api/submit/schema';
import { registerFormSettingsOpenApi } from '../../../../src/features/form-settings';
import { registerUserSearchOpenApi } from '../../../../src/features/user-search/schema';
import { registerJobsOpenApi } from '../../../../src/features/jobs/schema';
import { registerSubmissionExportOpenApi } from '../../../../src/features/submission-export/schema';

function componentSchemas(): unknown {
  const registry = new OpenAPIRegistry();
  registerFormsOpenApi(registry);
  registerFormSettingsOpenApi(registry);
  registerSubmissionsOpenApi(registry);
  registerWorkspacesOpenApi(registry);
  registerAdminOpenApi(registry);
  registerMetaOpenApi(registry);
  registerMeOpenApi(registry);
  registerUserSearchOpenApi(registry);
  registerJobsOpenApi(registry);
  registerSubmissionExportOpenApi(registry);
  registerSubmitOpenApi(registry);
  const doc = new OpenApiGeneratorV3(registry.definitions).generateDocument({
    openapi: '3.0.3',
    info: { title: 'test', version: '1' },
  });
  return doc.components?.schemas;
}

const at = (node: unknown, ...path: (string | number)[]): unknown =>
  path.reduce<unknown>(
    (cur, key) => (cur as Record<string | number, unknown> | undefined)?.[key],
    node,
  );

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

// The response shapes come from @soba/lib. Nested schemas must still resolve to the named
// components, not be inlined into every response that uses them.
describe('OpenAPI components for lib-backed schemas', () => {
  const schemas = componentSchemas();

  it.each([
    ['Credentials_CredentialState', 'Credentials_CredentialMetadata', 'Credentials_CredentialSort'],
    ['Forms_ListFormsResponse', 'Forms_FormListItem', 'Forms_FormSort'],
    ['Forms_ListFormVersionsResponse', 'Forms_FormVersionListItem', 'Forms_FormVersionSort'],
    [
      'Submissions_ListSubmissionsResponse',
      'Submissions_SubmissionListItem',
      'Submissions_SubmissionSort',
    ],
    ['Workspaces_ListWorkspacesResponse', 'Workspaces_WorkspaceItem', 'Workspaces_WorkspaceSort'],
    ['Submit_ListMyFormsResponse', 'Submit_MyFormListItem', 'Submit_MyFormSort'],
    [
      'Submit_ListMySubmissionsResponse',
      'Submit_MySubmissionListItem',
      'Submissions_SubmissionSort',
    ],
    ['Admin_ListSobaAdminsResponse', 'Admin_SobaAdminItem', 'Admin_SobaAdminSort'],
    ['Admin_ListFeatureScopesResponse', 'Admin_FeatureScopeItem', 'Admin_FeatureScopeSort'],
    [
      'Admin_ListDocumentGenerationAuditsResponse',
      'Admin_DocumentGenerationAuditItem',
      'Admin_DocgenAuditSort',
    ],
    ['Admin_ListJobsResponse', 'Admin_JobListItem', 'Admin_JobSort'],
    ['StaffJobs_ListResponse', 'StaffJobs_ListItem', 'StaffJobs_Sort'],
    ['SubmissionExport_ExportList', 'SubmissionExport_Export', 'SubmissionExport_Sort'],
  ])('%s references its item, page and sort components', (list, item, sort) => {
    expect(at(schemas, list, 'properties', 'items', 'items')).toEqual(ref(item));
    expect(at(schemas, list, 'properties', 'page')).toEqual(ref('Core_OffsetPage'));
    expect(at(schemas, list, 'properties', 'sort')).toEqual(ref(sort));
  });

  it.each([
    ['Meta_PluginsResponse', 'plugins', 'Meta_PluginCatalogEntry'],
    ['Meta_FeaturesResponse', 'features', 'Meta_Feature'],
    ['Meta_FormEnginesResponse', 'items', 'Meta_FormEngine'],
    ['Meta_LoginProvidersResponse', 'items', 'Meta_LoginProvider'],
    ['Meta_RolesResponse', 'roles', 'Meta_RoleWithSource'],
    ['Me_TenantsResponse', 'tenants', 'Me_Tenant'],
    ['Admin_ListJobTypesResponse', 'items', 'Admin_JobTypeItem'],
    ['StaffJobs_ListFormsResponse', 'items', 'StaffJobs_FormItem'],
  ])('%s references its %s item component', (response, property, item) => {
    expect(at(schemas, response, 'properties', property, 'items')).toEqual(ref(item));
  });

  it.each([
    ['Credentials_CredentialSecret', 'credential', 'Credentials_CredentialMetadata'],
    ['Me_Response', 'actor', 'Me_Actor'],
    ['Me_Response', 'profile', 'Me_Profile'],
    ['Me_Response', 'preferences', 'Me_Preferences'],
    ['Me_Response', 'capabilities', 'Me_Capabilities'],
    ['Me_PatchBody', 'preferences', 'Me_Preferences'],
    ['SubmissionExport_Export', 'progress', 'SubmissionExport_Progress'],
    ['SubmissionExport_Export', 'result', 'SubmissionExport_Result'],
  ])('%s references its %s component', (composite, property, child) => {
    expect(at(schemas, composite, 'properties', property)).toEqual(ref(child));
  });

  // The detail extends the named list item, so its own fields sit in the second allOf part.
  it.each([
    ['progress', 'Admin_JobProgress'],
    ['result', 'Admin_JobResult'],
  ])('Admin_JobDetail references its %s component', (property, child) => {
    expect(at(schemas, 'Admin_JobDetail', 'allOf', 1, 'properties', property)).toEqual(ref(child));
  });

  // Optional, never nullable: a nullable named schema leaks null into every other use of it.
  it.each([
    'SubmissionExport_Progress',
    'SubmissionExport_Result',
    'Admin_JobProgress',
    'Admin_JobResult',
  ])('keeps %s free of nullable at its top', (name) => {
    expect(at(schemas, name, 'nullable')).toBeUndefined();
  });

  it.each([
    ['Workspaces_WorkspaceLookupResponse', 'Workspaces_WorkspaceLookupItem'],
    ['Forms_FormVersionLookupResponse', 'Forms_FormVersionSummary'],
    ['Submit_MyWorkspaceLookupResponse', 'Submit_MyWorkspaceLookupItem'],
  ])('%s references its item component', (response, item) => {
    expect(at(schemas, response, 'properties', 'items', 'items')).toEqual(ref(item));
    expect(at(schemas, response, 'required')).toEqual(
      expect.arrayContaining(['items', 'limit', 'truncated']),
    );
  });

  it('builds the codes response on the named code row', () => {
    expect(at(schemas, 'Meta_CodesKeyedResponse', 'additionalProperties', 'items')).toEqual(
      ref('Meta_CodeRowWithSource'),
    );
  });

  it('names the submitter settings values', () => {
    expect(
      at(schemas, 'FormSettings_Submitter', 'properties', 'allowSubmitterDrafts', 'type'),
    ).toBe('boolean');
  });

  it.each(['Audience', 'Submitter'])(
    'builds the %s form view and save body on its values component',
    (name) => {
      const values = `FormSettings_${name}`;
      const view = `FormSettings_Form${name}`;
      expect(at(schemas, view, 'properties', 'workspace')).toEqual(ref(values));
      expect(at(schemas, view, 'properties', 'effective')).toEqual(ref(values));
      expect(at(schemas, view, 'properties', 'own', 'allOf', 0)).toEqual(ref(values));
      expect(
        at(schemas, `FormSettings_SetForm${name}Body`, 'oneOf', 1, 'properties', 'values'),
      ).toEqual(ref(values));
      expect(at(schemas, `FormSettings_Workspace${name}`, 'properties', 'values')).toEqual(
        ref(values),
      );
      // The form's own values may be null; the workspace's never are.
      expect(JSON.stringify(at(schemas, values))).not.toContain('nullable');
    },
  );

  it("builds the post-submission form view on the action's values component", () => {
    const values = 'PostSubmission_ActionValues';
    const view = 'PostSubmission_FormActionSettings';
    expect(at(schemas, view, 'properties', 'workspace')).toEqual(ref(values));
    expect(at(schemas, view, 'properties', 'effective')).toEqual(ref(values));
    expect(at(schemas, view, 'properties', 'own', 'allOf', 0)).toEqual(ref(values));
    // Only the form's own values may be null; the options' values are unknown, so nullable.
    expect(at(schemas, values, 'nullable')).toBeUndefined();
  });

  it('builds the post-submission lists on the named settings; only a form says if its workspace can set each', () => {
    const formItem = at(schemas, 'PostSubmission_FormActionList', 'properties', 'actions', 'items');
    const workspaceItem = at(
      schemas,
      'PostSubmission_WorkspaceActionList',
      'properties',
      'actions',
      'items',
    );
    expect(at(formItem, 'properties', 'settings')).toEqual(
      ref('PostSubmission_FormActionSettings'),
    );
    expect(at(formItem, 'properties', 'workspaceConfigurable', 'type')).toBe('boolean');
    expect(at(workspaceItem, 'properties', 'settings')).toEqual(
      ref('PostSubmission_WorkspaceActionSettings'),
    );
    expect(at(workspaceItem, 'properties', 'workspaceConfigurable')).toBeUndefined();
  });

  it('builds the job detail on the named list item, summary, counts and status', () => {
    const own = at(schemas, 'Admin_JobDetail', 'allOf', 1, 'properties');
    expect(at(schemas, 'Admin_JobDetail', 'allOf', 0)).toEqual(ref('Admin_JobListItem'));
    expect(at(own, 'parent')).toEqual(ref('Admin_JobSummary'));
    expect(at(own, 'children', 'items')).toEqual(ref('Admin_JobSummary'));
    expect(at(own, 'emailCounts')).toEqual(ref('Admin_JobEmailCounts'));
    expect(at(own, 'params')).toBeUndefined();
    expect(at(schemas, 'Admin_JobListItem', 'properties', 'status')).toEqual(
      ref('Admin_JobStatus'),
    );
    expect(at(schemas, 'Admin_JobSummary', 'properties', 'status')).toEqual(ref('Admin_JobStatus'));
  });

  it('builds the staff job detail on its own list item, summary, counts and status', () => {
    const own = at(schemas, 'StaffJobs_Detail', 'allOf', 1, 'properties');
    expect(at(schemas, 'StaffJobs_Detail', 'allOf', 0)).toEqual(ref('StaffJobs_ListItem'));
    expect(at(own, 'parent')).toEqual(ref('StaffJobs_Summary'));
    expect(at(own, 'children', 'items')).toEqual(ref('StaffJobs_Summary'));
    expect(at(own, 'emailCounts')).toEqual(ref('StaffJobs_EmailCounts'));
    expect(at(own, 'optionNames')).toBeUndefined();
    expect(at(own, 'revisionId')).toBeUndefined();
    expect(at(schemas, 'StaffJobs_ListItem', 'properties', 'workspaceId')).toBeUndefined();
    expect(at(schemas, 'StaffJobs_ListItem', 'properties', 'status')).toEqual(
      ref('StaffJobs_Status'),
    );
    // Inline: a nullable use of a named component would mark the component itself nullable.
    expect(at(own, 'lastRequeuedBy', 'nullable')).toBe(true);
    expect(at(own, 'lastRequeuedBy', 'properties', 'standing', 'enum')).toEqual([
      'member',
      'platformAdministrator',
      'formerMember',
    ]);
    expect(at(own, 'cancelRequestedBy', 'nullable')).toBe(true);
  });

  it('builds the form-with-version response on the named form response', () => {
    expect(at(schemas, 'Forms_FormWithVersionResponse', 'allOf', 0)).toEqual(
      ref('Forms_FormResponse'),
    );
  });

  // The My Forms row is the lib's submitter form; clients read these fields as-is.
  it('keeps the My Forms row shape', () => {
    const text = { type: 'string' };
    const textList = { type: 'array', items: text };
    expect(at(schemas, 'Submit_MyFormListItem')).toEqual({
      type: 'object',
      properties: {
        id: text,
        name: text,
        workspaceId: text,
        workspaceName: text,
        publishedVersionId: { ...text, nullable: true },
        permissions: textList,
        audienceMode: { ...text, nullable: true, enum: ['public', 'protected', 'members', null] },
        audienceIdps: textList,
        allowSubmitterDrafts: { type: 'boolean' },
      },
      required: [
        'id',
        'name',
        'workspaceId',
        'workspaceName',
        'publishedVersionId',
        'permissions',
        'audienceMode',
        'audienceIdps',
        'allowSubmitterDrafts',
      ],
    });
  });

  // The fill bundle's form is the same submitter form My Forms lists, and is never null.
  it('builds the fill bundle on the named submitter form and role', () => {
    expect(at(schemas, 'Submit_SubmitterForm')).toEqual(at(schemas, 'Submit_MyFormListItem'));
    expect(at(schemas, 'Submit_FillBundle', 'properties', 'form')).toEqual(
      ref('Submit_SubmitterForm'),
    );
    expect(at(schemas, 'Submit_FillBundle', 'properties', 'role')).toEqual(
      ref('Submit_MySubmissionRole'),
    );
    expect(at(schemas, 'Submit_MySubmissionRole', 'nullable')).toBeUndefined();
    expect(at(schemas, 'Submit_FillBundle', 'required')).toEqual(
      expect.arrayContaining(['formId', 'currentRevisionNo', 'role', 'form']),
    );
  });

  // A row's head revision is nullable, like its column; its forms are the named submitter form.
  it('builds My Submissions rows with their revision fields and the page forms', () => {
    const row = 'Submit_MySubmissionListItem';
    expect(at(schemas, row, 'properties', 'headRevisionId')).toEqual({
      type: 'string',
      nullable: true,
    });
    expect(at(schemas, row, 'properties', 'currentRevisionNo', 'type')).toBe('integer');
    expect(at(schemas, row, 'required')).toEqual(
      expect.arrayContaining(['formVersionId', 'headRevisionId', 'currentRevisionNo']),
    );
    const response = 'Submit_ListMySubmissionsResponse';
    expect(at(schemas, response, 'properties', 'forms', 'items')).toEqual(
      ref('Submit_SubmitterForm'),
    );
    expect(at(schemas, response, 'required')).toEqual(expect.arrayContaining(['forms']));
  });

  it('builds user search responses from the named person, status and provider components', () => {
    expect(at(schemas, 'UserSearch_Response', 'properties', 'users', 'items')).toEqual(
      ref('UserSearch_User'),
    );
    expect(at(schemas, 'UserSearch_Response', 'properties', 'plugins', 'items')).toEqual(
      ref('UserSearch_PluginStatus'),
    );
    expect(
      at(schemas, 'UserSearch_CapabilitiesResponse', 'properties', 'identityProviders', 'items'),
    ).toEqual(ref('UserSearch_IdentityProvider'));
    expect(at(schemas, 'UserSearch_User', 'properties', 'sobaUserId')).toEqual({
      type: 'string',
      nullable: true,
    });
  });
});
