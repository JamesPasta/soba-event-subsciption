import {
  effectiveAction,
  formActionScopes,
  rowsFor,
  toFormActionSettings,
  toWorkspaceActionSettings,
  type ActionSettingRow,
} from '../../../src/features/post-submission/rules';

const row = (overrides: Partial<ActionSettingRow>): ActionSettingRow => ({
  id: 'row',
  formId: null,
  actionCode: 'post-submission-email',
  inherit: false,
  enabled: true,
  options: {},
  version: 1,
  ...overrides,
});

const workspaceRow = row({ id: 'ws-row', options: { to: ['team@example.com'] }, version: 4 });
const formOverride = row({
  id: 'form-row',
  formId: 'f1',
  options: { to: ['form@example.com'] },
  version: 2,
});
const formInherits = row({ id: 'form-row', formId: 'f1', inherit: true, enabled: false });
const both = ['workspace', 'form'] as const;

describe('effectiveAction', () => {
  it("uses a form's own row when it overrides", () => {
    expect(effectiveAction(workspaceRow, formOverride, both)).toEqual({
      values: { enabled: true, options: { to: ['form@example.com'] } },
      source: { scope: 'form', settingId: 'form-row', version: 2 },
    });
  });

  it('follows the workspace when the form inherits or has no row', () => {
    const expected = {
      values: { enabled: true, options: { to: ['team@example.com'] } },
      source: { scope: 'workspace', settingId: 'ws-row', version: 4 },
    };
    expect(effectiveAction(workspaceRow, formInherits, both)).toEqual(expected);
    expect(effectiveAction(workspaceRow, undefined, both)).toEqual(expected);
  });

  it('is off, with no source, when nothing is saved', () => {
    expect(effectiveAction(undefined, undefined, both)).toEqual({
      values: { enabled: false, options: {} },
      source: null,
    });
  });

  it('ignores a workspace row for a form-only action', () => {
    expect(effectiveAction(workspaceRow, undefined, ['form']).source).toBeNull();
  });

  it('lets a form turn an inherited action off', () => {
    const off = row({ formId: 'f1', enabled: false });
    expect(effectiveAction(workspaceRow, off, both).values.enabled).toBe(false);
  });

  it("ignores a form's own row for a workspace-only action", () => {
    expect(effectiveAction(workspaceRow, formOverride, ['workspace']).source).toEqual({
      scope: 'workspace',
      settingId: 'ws-row',
      version: 4,
    });
  });
});

describe('formActionScopes', () => {
  it("keeps the action's scopes when the workspace can set it", () => {
    expect(formActionScopes(both, true)).toEqual(['workspace', 'form']);
  });

  it('drops the workspace scope when only the form can set it', () => {
    expect(formActionScopes(both, false)).toEqual(['form']);
    expect(formActionScopes(['workspace'], false)).toEqual([]);
  });
});

describe('settings views', () => {
  it("shows a form's choice, its own values, the workspace's and the effective ones", () => {
    expect(toFormActionSettings(workspaceRow, formOverride, both)).toEqual({
      inherit: false,
      own: { enabled: true, options: { to: ['form@example.com'] } },
      workspace: { enabled: true, options: { to: ['team@example.com'] } },
      effective: { enabled: true, options: { to: ['form@example.com'] } },
      version: 2,
    });
  });

  it('shows a form of a workspace-only action as inheriting, whatever its row says', () => {
    expect(toFormActionSettings(workspaceRow, formOverride, ['workspace'])).toMatchObject({
      inherit: true,
      own: null,
      effective: { enabled: true, options: { to: ['team@example.com'] } },
    });
  });

  it('reads a scope with no row as version 0, inheriting for a form and off for a workspace', () => {
    expect(toFormActionSettings(undefined, undefined, both)).toMatchObject({
      inherit: true,
      own: null,
      version: 0,
    });
    expect(toWorkspaceActionSettings(undefined)).toEqual({
      values: { enabled: false, options: {} },
      version: 0,
    });
  });

  it('shows a form whose workspace cannot set the action no workspace values to inherit', () => {
    expect(
      toFormActionSettings(workspaceRow, undefined, formActionScopes(both, false)),
    ).toMatchObject({
      inherit: true,
      workspace: { enabled: false, options: {} },
      effective: { enabled: false, options: {} },
    });
  });

  it("picks one action's workspace and form rows", () => {
    const other = row({ id: 'other', actionCode: 'post-submission-zip' });
    expect(rowsFor([other, workspaceRow, formOverride], 'post-submission-email')).toEqual({
      workspaceRow,
      formRow: formOverride,
    });
  });
});
