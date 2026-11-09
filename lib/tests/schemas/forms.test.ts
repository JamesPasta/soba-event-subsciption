import {
  CreateFormBodySchema,
  MyFormListItemSchema,
  SubmitterFormFactsSchema,
  SubmitterFormSchema,
} from '../../src/schemas/forms';
import { canStartSubmission, type SubmitterFormFacts } from '../../src/permissions';

const base = { workspaceId: 'ws1', name: 'My Form' };

const facts = {
  publishedVersionId: 'v1',
  permissions: ['submission_create'],
  audienceMode: 'members',
  audienceIdps: [],
  allowSubmitterDrafts: true,
  allowSubmitterRevision: false,
};

describe('submitter form schemas', () => {
  it('reads the facts the submitter rules take', () => {
    const parsed: SubmitterFormFacts = SubmitterFormFactsSchema.parse(facts);
    expect(canStartSubmission(parsed, { idpCode: 'idir' })).toBe(true);
  });

  it.each([
    ['an unknown audience', { audienceMode: 'everyone' }],
    ['a missing drafts setting', { allowSubmitterDrafts: undefined }],
    ['a missing revision setting', { allowSubmitterRevision: undefined }],
  ])('rejects facts with %s', (_label, overrides) => {
    expect(SubmitterFormFactsSchema.safeParse({ ...facts, ...overrides }).success).toBe(false);
  });

  it('carries what the form is alongside its facts', () => {
    const row = { id: 'f1', name: 'Permit', workspaceId: 'ws1', workspaceName: 'Roads', ...facts };
    expect(SubmitterFormSchema.parse(row)).toEqual(row);
  });

  it('lists My Forms rows as submitter forms', () => {
    expect(MyFormListItemSchema).toBe(SubmitterFormSchema);
  });
});

describe('CreateFormBodySchema settings', () => {
  it('accepts a form that inherits every group', () => {
    expect(CreateFormBodySchema.safeParse(base).success).toBe(true);
    expect(CreateFormBodySchema.safeParse({ ...base, settings: {} }).success).toBe(true);
  });

  it('accepts an audience for the new form', () => {
    const settings = { audience: { inherit: false, values: { mode: 'members', idps: [] } } };
    expect(CreateFormBodySchema.parse({ ...base, settings }).settings).toEqual(settings);
  });

  // A group the create does not apply would be dropped without a word, so it is refused.
  it.each([
    ['an unknown group', { submitter: { inherit: true } }],
    [
      'protected with no provider',
      { audience: { inherit: false, values: { mode: 'protected', idps: [] } } },
    ],
  ])('rejects %s', (_label, settings) => {
    expect(CreateFormBodySchema.safeParse({ ...base, settings }).success).toBe(false);
  });

  it('rejects a key outside settings that it does not know', () => {
    const submitterAudience = { mode: 'protected', idps: ['bceidbasic'] };
    expect(CreateFormBodySchema.safeParse({ ...base, submitterAudience }).success).toBe(false);
  });
});

describe('CreateFormBodySchema ids and schema', () => {
  const FORM_ID = '01a11400-0000-7000-8000-000000000001';
  const VERSION_ID = '01a11400-0000-7000-8000-000000000002';

  it('accepts caller-minted ids and a first-version schema', () => {
    const body = { ...base, id: FORM_ID, versionId: VERSION_ID, schema: { components: [] } };
    expect(CreateFormBodySchema.parse(body)).toEqual(body);
  });

  // Postgres returns uuids lowercase, and a retry is matched against the stored ids.
  it('lowercases the ids', () => {
    const body = { ...base, id: FORM_ID.toUpperCase(), versionId: VERSION_ID.toUpperCase() };
    expect(CreateFormBodySchema.parse(body)).toMatchObject({ id: FORM_ID, versionId: VERSION_ID });
  });

  it.each([
    ['a form id that is not a UUID', { id: 'form-1', versionId: VERSION_ID }],
    [
      'a version id that is not a UUIDv7',
      { id: FORM_ID, versionId: '6f9619ff-8b86-4011-b42d-00cf4fc964ff' },
    ],
    ['a schema that is not an object', { schema: 'components' }],
    ['a form id without a version id', { id: FORM_ID }],
    ['a version id without a form id', { versionId: VERSION_ID }],
  ])('rejects %s', (_label, fields) => {
    expect(CreateFormBodySchema.safeParse({ ...base, ...fields }).success).toBe(false);
  });
});
