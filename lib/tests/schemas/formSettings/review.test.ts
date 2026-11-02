import {
  ReviewSettingsSchema,
  SetFormReviewSettingsBodySchema,
  WorkspaceReviewSettingsSchema,
} from '../../../src/schemas/formSettings';

const values = { allowStatusUpdates: true, allowSubmitterRevision: false };

describe('review settings', () => {
  it('accepts the full settings object', () => {
    expect(WorkspaceReviewSettingsSchema.safeParse({ values, version: 1 }).success).toBe(true);
  });

  // A save sends every setting, so a missing or mistyped flag is refused rather than defaulted.
  it.each([
    ['no flags', {}],
    ['a missing status updates flag', { allowSubmitterRevision: true }],
    ['a missing revision flag', { allowStatusUpdates: true }],
    ['a non-boolean flag', { ...values, allowStatusUpdates: 'yes' }],
  ])('rejects %s', (_label, body) => {
    expect(ReviewSettingsSchema.safeParse(body).success).toBe(false);
    expect(
      SetFormReviewSettingsBodySchema.safeParse({ inherit: false, values: body, version: 1 })
        .success,
    ).toBe(false);
  });

  it('rejects a workspace save without a version', () => {
    expect(WorkspaceReviewSettingsSchema.safeParse({ values }).success).toBe(false);
  });

  it('saves a form as inheriting or with its own settings', () => {
    expect(SetFormReviewSettingsBodySchema.safeParse({ inherit: true, version: 1 }).success).toBe(
      true,
    );
    expect(
      SetFormReviewSettingsBodySchema.safeParse({ inherit: false, values, version: 1 }).success,
    ).toBe(true);
  });
});
