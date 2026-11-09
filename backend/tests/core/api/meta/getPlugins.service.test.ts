jest.mock('../../../../src/core/integrations/plugins/PluginRegistry', () => ({
  getPluginCatalog: jest.fn(),
  getActivePluginCodes: jest.fn(() =>
    jest
      .requireActual('../../../../src/core/integrations/plugins/PluginRegistry')
      .getActivePluginCodes(),
  ),
  getActiveStorageBackendCodes: jest.fn(() => new Set<string>()),
  getFeatureGatedPluginCodes: jest.fn(),
  getPostSubmissionActionPluginDefinitions: jest.fn(() => [{ code: 'post-submission-log' }]),
}));
jest.mock('../../../../src/core/integrations/form-engine/FormEngineRegistry', () => ({
  getFormEnginePlugins: jest.fn(() => []),
}));
jest.mock('../../../../src/core/db/repos/featureRepo', () => {
  const actual = jest.requireActual('../../../../src/core/db/repos/featureRepo');
  return { ...actual, listFeatures: jest.fn() };
});

import { metaApiService } from '../../../../src/core/api/meta/service';
import * as registry from '../../../../src/core/integrations/plugins/PluginRegistry';
import * as featureRepo from '../../../../src/core/db/repos/featureRepo';

const getPluginCatalog = registry.getPluginCatalog as unknown as jest.Mock;
const getFeatureGated = registry.getFeatureGatedPluginCodes as unknown as jest.Mock;
const listFeatures = featureRepo.listFeatures as unknown as jest.Mock;

describe('MetaApiService.getPlugins feature-gated enablement', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('enables a feature-gated plugin when its gating feature is enabled', async () => {
    getPluginCatalog.mockReturnValue([
      { code: 'cdogs-v2', hasApi: false },
      { code: 'cdogs-v3', hasApi: false },
      { code: 'docgen-noop', hasApi: false },
    ]);
    // Any plugin kind that declares a featureCode is reported here; docgen-noop declares none.
    getFeatureGated.mockReturnValue([
      { code: 'cdogs-v2', featureCode: 'document-generation-v2' },
      { code: 'cdogs-v3', featureCode: 'document-generation-v3' },
    ]);
    listFeatures.mockResolvedValue([
      { code: 'document-generation-v2', status: 'enabled' },
      { code: 'document-generation-v3', status: 'disabled' },
    ]);

    const { plugins } = await metaApiService.getPlugins();
    const enabledByCode = Object.fromEntries(plugins.map((p) => [p.code, p.enabled]));

    expect(enabledByCode['cdogs-v2']).toBe(true); // gating feature enabled
    expect(enabledByCode['cdogs-v3']).toBe(false); // gating feature disabled
    expect(enabledByCode['docgen-noop']).toBe(false); // not feature-gated
  });

  it.each([
    [undefined, { 'cstar-v1': false, 'tenant-noop': true }],
    ['cstar-v1', { 'cstar-v1': true, 'tenant-noop': false }],
  ])(
    'enables the default tenant engine (TENANT_ENGINE_DEFAULT_CODE=%s)',
    async (code, expected) => {
      if (code === undefined) delete process.env.TENANT_ENGINE_DEFAULT_CODE;
      else process.env.TENANT_ENGINE_DEFAULT_CODE = code;
      getPluginCatalog.mockReturnValue([
        { code: 'cstar-v1', hasApi: false },
        { code: 'tenant-noop', hasApi: false },
      ]);
      getFeatureGated.mockReturnValue([]);
      listFeatures.mockResolvedValue([]);

      const { plugins } = await metaApiService.getPlugins();
      expect(Object.fromEntries(plugins.map((p) => [p.code, p.enabled]))).toEqual(expected);
    },
  );

  it.each([
    [undefined, { 'cs-workflow-v1': false, 'workflow-noop': true }],
    ['cs-workflow-v1', { 'cs-workflow-v1': true, 'workflow-noop': false }],
  ])(
    'enables the default workflow engine (WORKFLOW_ENGINE_DEFAULT_CODE=%s)',
    async (code, expected) => {
      if (code === undefined) delete process.env.WORKFLOW_ENGINE_DEFAULT_CODE;
      else process.env.WORKFLOW_ENGINE_DEFAULT_CODE = code;
      getPluginCatalog.mockReturnValue([
        { code: 'cs-workflow-v1', hasApi: false },
        { code: 'workflow-noop', hasApi: false },
      ]);
      getFeatureGated.mockReturnValue([]);
      listFeatures.mockResolvedValue([]);

      const { plugins } = await metaApiService.getPlugins();
      expect(Object.fromEntries(plugins.map((p) => [p.code, p.enabled]))).toEqual(expected);
    },
  );
  it.each([
    [undefined, { 'aps-credential-issuer-v3': false, 'credential-issuer-noop': true }],
    [
      'aps-credential-issuer-v3',
      { 'aps-credential-issuer-v3': true, 'credential-issuer-noop': false },
    ],
  ])('marks the selected credential issuer active (%s)', async (code, expected) => {
    if (code === undefined) delete process.env.CREDENTIAL_ISSUER_DEFAULT_CODE;
    else process.env.CREDENTIAL_ISSUER_DEFAULT_CODE = code;
    getPluginCatalog.mockReturnValue([
      { code: 'aps-credential-issuer-v3', hasApi: false },
      { code: 'credential-issuer-noop', hasApi: false },
    ]);
    getFeatureGated.mockReturnValue([]);
    listFeatures.mockResolvedValue([]);
    const { plugins } = await metaApiService.getPlugins();
    expect(Object.fromEntries(plugins.map((plugin) => [plugin.code, plugin.enabled]))).toEqual(
      expected,
    );
  });

  it.each([
    [undefined, false],
    ['post-submission-log', true],
  ])(
    'enables an installed action plugin that POST_SUBMISSION_ACTION_PLUGINS lists (%s)',
    async (codes, expected) => {
      if (codes === undefined) delete process.env.POST_SUBMISSION_ACTION_PLUGINS;
      else process.env.POST_SUBMISSION_ACTION_PLUGINS = codes;
      getPluginCatalog.mockReturnValue([{ code: 'post-submission-log', hasApi: false }]);
      getFeatureGated.mockReturnValue([]);
      listFeatures.mockResolvedValue([]);

      const { plugins } = await metaApiService.getPlugins();
      expect(plugins).toEqual([{ code: 'post-submission-log', hasApi: false, enabled: expected }]);
    },
  );
});
