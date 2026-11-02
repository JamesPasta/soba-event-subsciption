import { SubmitFillBundleSchema } from '../../src/schemas/submit';

const bundle = {
  formId: 'f1',
  workflowState: 'draft',
  formVersionId: 'v1',
  headRevisionId: 'r1',
  currentRevisionNo: 1,
  role: 'owner',
  form: {
    id: 'f1',
    name: 'Permit application',
    workspaceId: 'ws1',
    workspaceName: 'Roads',
    publishedVersionId: 'v1',
    permissions: ['submission_create'],
    audienceMode: 'members',
    audienceIdps: [],
    allowSubmitterDrafts: true,
    allowSubmitterRevision: false,
  },
  schema: { components: [] },
  content: null,
};

/** A copy of the object without the key. */
const without = <T extends object>(source: T, key: keyof T): Partial<T> => {
  const copy: Partial<T> = { ...source };
  delete copy[key];
  return copy;
};

describe('SubmitFillBundleSchema', () => {
  it('accepts a bundle with the caller role and the form facts', () => {
    expect(SubmitFillBundleSchema.safeParse(bundle).success).toBe(true);
    expect(SubmitFillBundleSchema.safeParse({ ...bundle, role: 'collaborator' }).success).toBe(
      true,
    );
  });

  it.each(['formId', 'currentRevisionNo', 'role', 'form'] as const)('requires %s', (field) => {
    expect(SubmitFillBundleSchema.safeParse(without(bundle, field)).success).toBe(false);
  });

  it.each([
    ['no role', null],
    ['an unknown role', 'viewer'],
  ])('rejects %s', (_label, role) => {
    expect(SubmitFillBundleSchema.safeParse({ ...bundle, role }).success).toBe(false);
  });

  it('rejects a form without its facts', () => {
    const form = without(bundle.form, 'permissions');
    expect(SubmitFillBundleSchema.safeParse({ ...bundle, form }).success).toBe(false);
  });
});
