import { z } from 'zod';
import type {
  PostSubmissionActionPluginDefinition,
  PostSubmissionActionScope,
} from '../../../src/core/integrations/post-submission-action/PostSubmissionActionPluginDefinition';
import { getPostSubmissionActions } from '../../../src/core/integrations/post-submission-action/PostSubmissionActionRegistry';
import {
  isFeatureAvailable,
  type FeatureScopeContext,
} from '../../../src/core/services/featureAvailabilityService';
import type { ActionSettingRow } from '../../../src/features/post-submission/rules';
import {
  availableActions,
  chooseSubmittedActions,
  formAction,
  isWorkspaceConfigurable,
  type ScopedAction,
} from '../../../src/features/post-submission/resolve';

jest.mock('../../../src/core/db/client', () => ({ db: {}, quietDb: {} }));
jest.mock('../../../src/core/services/featureAvailabilityService', () => ({
  isFeatureAvailable: jest.fn(),
}));
jest.mock(
  '../../../src/core/integrations/post-submission-action/PostSubmissionActionRegistry',
  () => ({ getPostSubmissionActions: jest.fn() }),
);

const plugin = (
  code: string,
  overrides: Partial<PostSubmissionActionPluginDefinition> = {},
): PostSubmissionActionPluginDefinition => ({
  code,
  metadata: { code, name: code },
  scopes: ['workspace', 'form'],
  optionsSchema: z.object({}),
  job: { pool: 'light', run: () => Promise.resolve() },
  ...overrides,
});

/**
 * Grants as `<feature>:<form|workspace>:<id>`. A check matches a grant to the form it names or to
 * the workspace it names, as the grant lookup does; a check without a form id never matches a form
 * grant.
 */
const granting = (...grants: string[]) =>
  (isFeatureAvailable as jest.Mock).mockImplementation((code: string, scope: FeatureScopeContext) =>
    Promise.resolve(
      grants.includes(`${code}:form:${scope.formId}`) ||
        grants.includes(`${code}:workspace:${scope.workspaceId}`),
    ),
  );

const email = plugin('post-submission-email-addresses', {
  featureCode: 'post-submission-email',
});

describe('formAction', () => {
  it('keeps both scopes where the workspace holds both features', async () => {
    granting('post-submission:workspace:w1', 'post-submission-email:workspace:w1');
    await expect(formAction(email, 'w1', 'f1')).resolves.toEqual({
      plugin: email,
      scopes: ['workspace', 'form'],
    });
  });

  it('keeps the form scope only where the form alone holds the features', async () => {
    granting('post-submission:form:f1', 'post-submission-email:form:f1');
    await expect(formAction(email, 'w1', 'f1')).resolves.toEqual({
      plugin: email,
      scopes: ['form'],
    });
  });

  it("drops the workspace scope when the workspace lacks the action's own feature", async () => {
    granting('post-submission:workspace:w1', 'post-submission-email:form:f1');
    await expect(formAction(email, 'w1', 'f1')).resolves.toEqual({
      plugin: email,
      scopes: ['form'],
    });
  });

  it("is null without the action's feature for the form", async () => {
    granting('post-submission:workspace:w1');
    await expect(formAction(email, 'w1', 'f1')).resolves.toBeNull();
  });

  it('is null for a workspace-only action the workspace cannot set', async () => {
    granting('post-submission:form:f1', 'post-submission-email:form:f1');
    const workspaceOnly = plugin('post-submission-zip', {
      featureCode: 'post-submission-email',
      scopes: ['workspace'],
    });
    await expect(formAction(workspaceOnly, 'w1', 'f1')).resolves.toBeNull();
  });
});

describe('isWorkspaceConfigurable', () => {
  it('needs post-submission and the action feature for the workspace itself', async () => {
    granting('post-submission:workspace:w1', 'post-submission-email:workspace:w1');
    await expect(isWorkspaceConfigurable(email, 'w1')).resolves.toBe(true);
    expect(isFeatureAvailable).toHaveBeenCalledWith('post-submission', { workspaceId: 'w1' });
    expect(isFeatureAvailable).toHaveBeenCalledWith('post-submission-email', { workspaceId: 'w1' });
  });

  it('needs only post-submission for an action without a feature of its own', async () => {
    granting('post-submission:workspace:w1');
    await expect(isWorkspaceConfigurable(plugin('post-submission-log'), 'w1')).resolves.toBe(true);
  });

  it('is false for an action without a workspace scope, without asking', async () => {
    (isFeatureAvailable as jest.Mock).mockClear();
    const formOnly = plugin('post-submission-form', { scopes: ['form'] });
    await expect(isWorkspaceConfigurable(formOnly, 'w1')).resolves.toBe(false);
    expect(isFeatureAvailable).not.toHaveBeenCalled();
  });
});

describe('availableActions', () => {
  it('lists the enabled actions the form can set, in order, each with its scopes', async () => {
    const log = plugin('post-submission-log');
    (getPostSubmissionActions as jest.Mock).mockReturnValue([email, log]);
    granting('post-submission:form:f1');
    await expect(availableActions('w1', 'f1')).resolves.toEqual([
      { plugin: log, scopes: ['form'] },
    ]);
  });
});

const action = (
  code: string,
  scopes: PostSubmissionActionScope[] = ['workspace', 'form'],
): ScopedAction => ({ plugin: plugin(code), scopes });

const row = (actionCode: string, overrides: Partial<ActionSettingRow> = {}): ActionSettingRow => ({
  id: `${actionCode}-ws`,
  formId: null,
  actionCode,
  inherit: false,
  enabled: true,
  options: { note: actionCode },
  version: 1,
  ...overrides,
});

describe('chooseSubmittedActions', () => {
  it('records each available action its settings turn on, with its options and source', () => {
    expect(
      chooseSubmittedActions([row('post-submission-on')], [action('post-submission-on')]),
    ).toEqual([
      {
        code: 'post-submission-on',
        options: { note: 'post-submission-on' },
        source: { scope: 'workspace', settingId: 'post-submission-on-ws', version: 1 },
      },
    ]);
  });

  it('leaves out an action turned off, one with no settings, and settings with no available plugin', () => {
    const rows = [row('post-submission-off', { enabled: false }), row('post-submission-gone')];
    const actions = [action('post-submission-off'), action('post-submission-unset')];
    expect(chooseSubmittedActions(rows, actions)).toEqual([]);
  });

  it("uses a form's override over the workspace default", () => {
    const rows = [
      row('post-submission-on'),
      row('post-submission-on', { id: 'form', formId: 'f1', options: { note: 'form' } }),
    ];
    expect(chooseSubmittedActions(rows, [action('post-submission-on')])).toEqual([
      expect.objectContaining({
        options: { note: 'form' },
        source: { scope: 'form', settingId: 'form', version: 1 },
      }),
    ]);
  });

  it('ignores the workspace row for a form whose workspace cannot set the action', () => {
    const formOnly = [action('post-submission-on', ['form'])];
    const inherits = row('post-submission-on', { id: 'form', formId: 'f1', inherit: true });
    const own = row('post-submission-on', { id: 'form', formId: 'f1', options: { note: 'form' } });

    expect(chooseSubmittedActions([row('post-submission-on')], formOnly)).toEqual([]);
    expect(chooseSubmittedActions([row('post-submission-on'), inherits], formOnly)).toEqual([]);
    expect(chooseSubmittedActions([row('post-submission-on'), own], formOnly)).toEqual([
      expect.objectContaining({ source: { scope: 'form', settingId: 'form', version: 1 } }),
    ]);
  });

  it('records actions in the order the plugins are enabled', () => {
    const rows = [row('post-submission-b'), row('post-submission-a')];
    const actions = [action('post-submission-a'), action('post-submission-b')];
    expect(chooseSubmittedActions(rows, actions).map((chosen) => chosen.code)).toEqual([
      'post-submission-a',
      'post-submission-b',
    ]);
  });
});
