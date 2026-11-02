import {
  audienceAdmits,
  canSaveSubmissionDraft,
  canStartSubmission,
  draftSaveStatusOf,
  formAccessAllows,
  hasAllPermissions,
  isAudiencePermission,
  isIdentifiedCaller,
  Permissions,
  type SubmitterFormFacts,
} from '../../src/permissions';

const idir = { idpCode: 'idir' };
const bceid = { idpCode: 'bceid' };
const anonymous = { idpCode: 'public' };

const form = (overrides: Partial<SubmitterFormFacts> = {}): SubmitterFormFacts => ({
  publishedVersionId: 'v1',
  permissions: [],
  audienceMode: 'members',
  audienceIdps: [],
  allowSubmitterDrafts: false,
  allowSubmitterRevision: false,
  ...overrides,
});

describe('hasAllPermissions', () => {
  it('needs every required code, unless the wildcard is held', () => {
    expect(hasAllPermissions(['form_read'], ['form_read'])).toBe(true);
    expect(hasAllPermissions(['form_read'], ['form_read', 'form_update'])).toBe(false);
    expect(hasAllPermissions(new Set(['*']), ['form_update'])).toBe(true);
    expect(hasAllPermissions([], [])).toBe(true);
  });
});

describe('isIdentifiedCaller', () => {
  it('is a caller signed in through a real provider', () => {
    expect(isIdentifiedCaller(idir)).toBe(true);
    expect(isIdentifiedCaller(anonymous)).toBe(false);
    expect(isIdentifiedCaller({})).toBe(false);
  });
});

describe('audienceAdmits', () => {
  it.each([
    ['public admits a signed-in caller', 'public', [], idir, true],
    ['public admits an anonymous caller', 'public', [], anonymous, true],
    ['protected admits a listed provider', 'protected', ['idir'], idir, true],
    ['protected refuses an unlisted provider', 'protected', ['idir'], bceid, false],
    ['protected refuses an anonymous caller', 'protected', ['idir'], anonymous, false],
    ['protected refuses a caller with no provider', 'protected', ['idir'], {}, false],
    ['members admits no one', 'members', [], idir, false],
    ['no audience admits no one', null, [], idir, false],
  ] as const)('%s', (_label, audienceMode, audienceIdps, caller, expected) => {
    expect(audienceAdmits({ audienceMode, audienceIdps }, caller)).toBe(expected);
  });
});

describe('isAudiencePermission', () => {
  it('is the two codes an audience can convey, and nothing staff-only', () => {
    const conveyed = Object.values(Permissions).filter((code) => isAudiencePermission(code));
    expect(conveyed.sort()).toEqual(['document_template_read', 'submission_create'].sort());
  });
});

describe('formAccessAllows', () => {
  it("never counts the public user's roles", () => {
    expect(formAccessAllows(form({ permissions: ['*'] }), anonymous, 'submission_create')).toBe(
      false,
    );
    expect(formAccessAllows(form({ permissions: ['*'] }), {}, 'submission_create')).toBe(true);
  });

  it('allows by role, including the wildcard', () => {
    expect(
      formAccessAllows(form({ permissions: ['submission_create'] }), idir, 'submission_create'),
    ).toBe(true);
    expect(formAccessAllows(form({ permissions: ['*'] }), idir, 'submission_update')).toBe(true);
    expect(
      formAccessAllows(form({ permissions: ['submission_read'] }), idir, 'submission_create'),
    ).toBe(false);
  });

  it('allows an audience permission when the audience admits the caller', () => {
    const open = form({ audienceMode: 'protected', audienceIdps: ['idir'] });
    expect(formAccessAllows(open, idir, 'submission_create')).toBe(true);
    expect(formAccessAllows(open, idir, 'document_template_read')).toBe(true);
    expect(formAccessAllows(open, bceid, 'submission_create')).toBe(false);
  });

  it('never conveys a staff permission through the audience', () => {
    const everyone = form({ audienceMode: 'public' });
    expect(formAccessAllows(everyone, idir, 'submission_update')).toBe(false);
    expect(formAccessAllows(everyone, idir, 'form_update')).toBe(false);
    expect(formAccessAllows(everyone, idir, 'form_read')).toBe(false);
    expect(formAccessAllows(everyone, idir, 'submission_read')).toBe(false);
  });

  it('allows the staff read codes by role', () => {
    const reviewer = form({ permissions: ['form_read', 'submission_read'] });
    expect(formAccessAllows(reviewer, idir, 'form_read')).toBe(true);
    expect(formAccessAllows(reviewer, idir, 'submission_read')).toBe(true);
  });
});

describe('draftSaveStatusOf', () => {
  it.each([
    ['off', false, 'protected', 'disabled'],
    ['off, even when public', false, 'public', 'disabled'],
    ['on, public', true, 'public', 'public'],
    ['on, protected', true, 'protected', 'allowed'],
    ['on, members', true, 'members', 'allowed'],
  ] as const)('drafts %s', (_label, allowSubmitterDrafts, audienceMode, expected) => {
    expect(draftSaveStatusOf({ allowSubmitterDrafts, audienceMode })).toBe(expected);
  });
});

describe('canStartSubmission and canSaveSubmissionDraft', () => {
  it('needs a published version to start, whatever the access', () => {
    const unpublished = form({ publishedVersionId: null, permissions: ['*'] });
    expect(canStartSubmission(unpublished, idir)).toBe(false);
    expect(canSaveSubmissionDraft({ ...unpublished, allowSubmitterDrafts: true }, idir)).toBe(
      false,
    );
  });

  it('starts by role or by audience', () => {
    expect(canStartSubmission(form({ permissions: ['submission_create'] }), idir)).toBe(true);
    expect(canStartSubmission(form({ audienceMode: 'public' }), idir)).toBe(true);
    expect(canStartSubmission(form(), idir)).toBe(false);
  });

  it('saves a draft only where a submission can start and drafts are allowed', () => {
    const submitter = form({ permissions: ['submission_create'], audienceMode: 'protected' });
    expect(canSaveSubmissionDraft({ ...submitter, allowSubmitterDrafts: true }, idir)).toBe(true);
    expect(canSaveSubmissionDraft(submitter, idir)).toBe(false);
    expect(
      canSaveSubmissionDraft(form({ audienceMode: 'public', allowSubmitterDrafts: true }), idir),
    ).toBe(false);
    expect(canSaveSubmissionDraft(form({ allowSubmitterDrafts: true }), idir)).toBe(false);
  });
});
