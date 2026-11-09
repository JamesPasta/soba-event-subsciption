import { z } from 'zod';
import { ValidationError } from '../../../src/core/errors';
import type { PostSubmissionActionPluginDefinition } from '../../../src/core/integrations/post-submission-action/PostSubmissionActionPluginDefinition';
import {
  checkedOptions,
  formOwnValues,
} from '../../../src/features/post-submission/settings/service';

jest.mock('../../../src/core/db/client', () => ({ db: {}, quietDb: {} }));

const plugin: PostSubmissionActionPluginDefinition = {
  code: 'post-submission-email',
  metadata: { code: 'post-submission-email', name: 'Email' },
  scopes: ['form'],
  optionsSchema: z.strictObject({ to: z.array(z.email()).min(1) }),
  job: { pool: 'light', run: () => Promise.resolve() },
};

describe('checkedOptions', () => {
  it("stores the plugin schema's output for an action that is on", () => {
    expect(checkedOptions(plugin, { enabled: true, options: { to: ['a@example.com'] } })).toEqual({
      to: ['a@example.com'],
    });
  });

  it('lets an action that is off keep no options', () => {
    expect(checkedOptions(plugin, { enabled: false, options: {} })).toEqual({});
  });

  it("refuses options the plugin's schema rejects, naming the field", () => {
    expect(() => checkedOptions(plugin, { enabled: true, options: { to: ['nope'] } })).toThrow(
      ValidationError,
    );
    expect(() => checkedOptions(plugin, { enabled: true, options: { to: ['nope'] } })).toThrow(
      /^Invalid options for post-submission-email: to\.0: /,
    );
  });

  it('checks options kept on an action that is off', () => {
    expect(() => checkedOptions(plugin, { enabled: false, options: { cc: [] } })).toThrow(
      ValidationError,
    );
  });
});

describe('formOwnValues', () => {
  const values = { enabled: true, options: { to: ['a@example.com'] } };
  const workspaceOnly = {
    ...plugin,
    scopes: ['workspace'],
  } as PostSubmissionActionPluginDefinition;

  it("takes a form's own values for an action with a form scope", () => {
    expect(formOwnValues(plugin, { inherit: false, values, version: 1 })).toEqual(values);
  });

  it('lets any form inherit', () => {
    expect(formOwnValues(workspaceOnly, { inherit: true, version: 1 })).toBeNull();
  });

  it('refuses own values for a workspace-only action', () => {
    expect(() => formOwnValues(workspaceOnly, { inherit: false, values, version: 1 })).toThrow(
      new ValidationError('post-submission-email is set for the workspace only'),
    );
  });
});
