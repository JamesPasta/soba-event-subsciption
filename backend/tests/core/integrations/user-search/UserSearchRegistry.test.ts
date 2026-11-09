import {
  checkUserSearchReadiness,
  createUserSearchAdapter,
  getEnabledUserSearchPluginCodes,
  getUserSearchPlugins,
  resolveUserSearchPlugin,
} from '../../../../src/core/integrations/user-search/UserSearchRegistry';
import { CssUserSearchAdapter } from '../../../../src/plugins/css-v1/cssUserSearchAdapter';

const CSS_CONFIG = {
  PLUGIN_CSS_V1_API_BASE_URL: 'http://css.test/api/v1',
  PLUGIN_CSS_V1_ENVIRONMENT: 'test',
  PLUGIN_CSS_V1_TOKEN_URL: 'http://css.test/token',
  PLUGIN_CSS_V1_CLIENT_ID: 'client',
  PLUGIN_CSS_V1_CLIENT_SECRET: 'secret',
};

describe('UserSearchRegistry', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('discovers the css plugin and rejects unknown codes', () => {
    expect(getUserSearchPlugins()).toEqual(
      expect.arrayContaining([{ code: 'css-v1', name: 'CSS user search', version: 'v1' }]),
    );
    expect(() => resolveUserSearchPlugin('nope')).toThrow(/No user search plugin/);
  });

  it('creates a configured adapter', () => {
    Object.assign(process.env, CSS_CONFIG);
    expect(createUserSearchAdapter('css-v1')).toBeInstanceOf(CssUserSearchAdapter);
  });

  it('enables the listed plugins once each, in order, and none when unset', () => {
    process.env.USER_SEARCH_PLUGINS = 'css-v1, other-v1,css-v1';
    expect(getEnabledUserSearchPluginCodes()).toEqual(['css-v1', 'other-v1']);

    delete process.env.USER_SEARCH_PLUGINS;
    expect(getEnabledUserSearchPluginCodes()).toEqual([]);
  });

  it('reports readiness for enabled plugins only, failing unknown codes and missing config', async () => {
    process.env.USER_SEARCH_PLUGINS = 'css-v1,nope';
    Object.assign(process.env, { ...CSS_CONFIG, PLUGIN_CSS_V1_CLIENT_SECRET: '' });

    const readiness = await checkUserSearchReadiness();

    expect(Object.keys(readiness)).toEqual(['css-v1', 'nope']);
    expect(readiness['css-v1']).toEqual({
      ok: false,
      message: 'PLUGIN_CSS_V1_CLIENT_SECRET is required',
    });
    expect(readiness.nope).toEqual({
      ok: false,
      message: "No user search plugin is installed for code 'nope'",
    });
  });
});
