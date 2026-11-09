import {
  SetFormSubmitterSettingsBodySchema,
  SubmitterSettingsSchema,
  WorkspaceSubmitterSettingsSchema,
} from '../../../src/schemas/formSettings';

describe('submitter settings', () => {
  it('accepts the full settings object', () => {
    expect(
      WorkspaceSubmitterSettingsSchema.safeParse({
        values: { allowSubmitterDrafts: true },
        version: 1,
      }).success,
    ).toBe(true);
  });

  // A save sends every setting, so a missing or mistyped flag is refused rather than defaulted.
  it.each([
    ['a missing flag', {}],
    ['a non-boolean flag', { allowSubmitterDrafts: 'yes' }],
  ])('rejects %s', (_label, body) => {
    expect(SubmitterSettingsSchema.safeParse(body).success).toBe(false);
    expect(
      SetFormSubmitterSettingsBodySchema.safeParse({ inherit: false, values: body, version: 1 })
        .success,
    ).toBe(false);
  });

  it('saves a form as inheriting or with its own settings', () => {
    expect(
      SetFormSubmitterSettingsBodySchema.safeParse({ inherit: true, version: 1 }).success,
    ).toBe(true);
    expect(
      SetFormSubmitterSettingsBodySchema.safeParse({
        inherit: false,
        values: { allowSubmitterDrafts: true },
        version: 1,
      }).success,
    ).toBe(true);
  });
});
