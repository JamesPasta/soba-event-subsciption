import {
  canContinueSubmission,
  canDeleteOwnSubmission,
  canDeleteSubmissionFile,
  canReadSubmission,
  canReadVersionSchema,
  canRenderSubmission,
  canReviseSubmission,
  canSaveDraftOnSubmission,
  canStartSubmission,
  canUploadSubmissionFile,
  canWriteSubmission,
  isSubmissionEditable,
  isSubmissionInProgress,
  ownDeleteStatusOf,
  reviseStatusOf,
  Permissions,
  saveDraftStatusOf,
  startStatusOf,
  SubmissionWorkflowState,
  uploadStatusOf,
  versionSchemaStatusOf,
  type AccessCaller,
  type SubmissionAccessFacts,
  type SubmitterFormFacts,
} from '../../src/permissions';
import type { SubmitterReviewLabel } from '../../src/schemas/submissionReview';

const STATES = Object.values(SubmissionWorkflowState);

const idir: AccessCaller = { idpCode: 'idir' };
const bceid: AccessCaller = { idpCode: 'bceid' };
const anonymous: AccessCaller = { idpCode: 'public' };

const form = (overrides: Partial<SubmitterFormFacts> = {}): SubmitterFormFacts => ({
  publishedVersionId: 'v1',
  permissions: [],
  audienceMode: 'members',
  audienceIdps: [],
  allowSubmitterDrafts: true,
  allowSubmitterRevision: false,
  ...overrides,
});

const SUBMITTER = [Permissions.submission_create, Permissions.document_template_read];

const forms = {
  roles: form({ permissions: SUBMITTER }),
  rolesUnpublished: form({ permissions: SUBMITTER, publishedVersionId: null }),
  rolesNoDrafts: form({ permissions: SUBMITTER, allowSubmitterDrafts: false }),
  public: form({ audienceMode: 'public' }),
  protectedIdir: form({ audienceMode: 'protected', audienceIdps: ['idir'] }),
  staff: form({ permissions: [Permissions.submission_update] }),
};

const sub = (role: string | null, workflowState: string): SubmissionAccessFacts => ({
  role,
  workflowState,
});

interface Expected {
  read: boolean;
  write: boolean;
  continue: boolean;
  saveDraft: boolean;
  upload: boolean;
  deleteFile: boolean;
  render: boolean;
  deleteOwn: boolean;
}

const all = (value: boolean): Expected => ({
  read: value,
  write: value,
  continue: value,
  saveDraft: value,
  upload: value,
  deleteFile: value,
  render: value,
  deleteOwn: value,
});

const CASES: Array<[string, SubmissionAccessFacts, SubmitterFormFacts, AccessCaller, Expected]> = [
  ['owner of a draft, by role', sub('owner', 'draft'), forms.roles, idir, all(true)],
  ['owner of an opened submission', sub('owner', 'opened'), forms.roles, idir, all(true)],
  [
    'owner of a submitted submission',
    sub('owner', 'submitted'),
    forms.roles,
    idir,
    { ...all(true), continue: false, upload: false, deleteFile: false, deleteOwn: false },
  ],
  [
    'owner of a submission sent back to revise',
    sub('owner', 'revising'),
    forms.roles,
    idir,
    { ...all(true), deleteOwn: false },
  ],
  [
    'collaborator on a submission sent back to revise',
    sub('collaborator', 'revising'),
    forms.roles,
    idir,
    { ...all(true), deleteOwn: false },
  ],
  [
    'staff with update on a submission sent back to revise',
    sub(null, 'revising'),
    forms.staff,
    idir,
    all(false),
  ],
  [
    'collaborator on a draft',
    sub('collaborator', 'draft'),
    forms.roles,
    idir,
    { ...all(true), deleteOwn: false },
  ],
  [
    'audience-admitted caller with no grant',
    sub(null, 'draft'),
    forms.protectedIdir,
    idir,
    all(false),
  ],
  [
    'role holder the audience does not admit',
    sub('owner', 'draft'),
    form({ audienceMode: 'protected', audienceIdps: ['idir'], permissions: SUBMITTER }),
    bceid,
    all(true),
  ],
  [
    'owner who may no longer write still deletes their draft',
    sub('owner', 'draft'),
    forms.protectedIdir,
    bceid,
    { ...all(false), read: true, deleteOwn: true },
  ],
  [
    'public caller on an anonymous draft of a public form',
    sub('owner', 'draft'),
    forms.public,
    anonymous,
    { ...all(true), saveDraft: false, deleteOwn: false },
  ],
  [
    'public caller on an anonymous submitted submission',
    sub('owner', 'submitted'),
    forms.public,
    anonymous,
    { ...all(false), read: true, write: true, render: true },
  ],
  [
    "public caller holding the form's roles",
    sub('owner', 'draft'),
    forms.roles,
    anonymous,
    { ...all(false), read: true },
  ],
  [
    'existing draft on a form with no published version',
    sub('owner', 'draft'),
    forms.rolesUnpublished,
    idir,
    all(true),
  ],
  [
    'owner of a draft on a form with drafts off',
    sub('owner', 'draft'),
    forms.rolesNoDrafts,
    idir,
    { ...all(true), saveDraft: false },
  ],
  [
    'staff with update on a submitted submission',
    sub(null, 'submitted'),
    forms.staff,
    idir,
    { ...all(false), deleteFile: true },
  ],
  [
    'staff with update on a draft they hold no grant on',
    sub(null, 'draft'),
    forms.staff,
    idir,
    all(false),
  ],
  [
    'owner of a draft on a form granting create but not template read',
    sub('owner', 'draft'),
    form({ permissions: [Permissions.submission_create] }),
    idir,
    { ...all(true), render: false },
  ],
  [
    'owner with update, on a submission neither in progress nor submitted',
    sub('owner', 'archived'),
    form({ permissions: [...SUBMITTER, Permissions.submission_update] }),
    idir,
    { ...all(false), read: true, write: true, saveDraft: true, render: true },
  ],
];

describe('submission rules', () => {
  it.each(CASES)('%s', (_label, submission, facts, caller, expected) => {
    expect({
      read: canReadSubmission(submission),
      write: canWriteSubmission(submission, facts, caller),
      continue: canContinueSubmission(submission, facts, caller),
      saveDraft: canSaveDraftOnSubmission(submission, facts, caller),
      upload: canUploadSubmissionFile(submission, facts, caller),
      deleteFile: canDeleteSubmissionFile(submission, facts, caller),
      render: canRenderSubmission(submission, facts, caller),
      deleteOwn: canDeleteOwnSubmission(submission, caller),
    }).toEqual(expected);
  });

  it.each(STATES)('isSubmissionInProgress answers %s', (state) => {
    expect(isSubmissionInProgress(state)).toBe(state === 'opened' || state === 'draft');
  });

  it('treats an unknown state as not in progress', () => {
    expect(isSubmissionInProgress('archived')).toBe(false);
  });

  it.each(STATES)('isSubmissionEditable answers %s', (state) => {
    expect(isSubmissionEditable(state)).toBe(
      state === 'opened' || state === 'draft' || state === 'revising',
    );
  });

  it.each([
    ['allowed', sub('owner', 'draft'), forms.roles, idir, { status: 'allowed' }],
    [
      'a caller who may not write',
      sub(null, 'draft'),
      forms.roles,
      idir,
      { status: 'denied', code: 'write_denied' },
    ],
    [
      'drafts off',
      sub('owner', 'draft'),
      forms.rolesNoDrafts,
      idir,
      { status: 'denied', code: 'drafts_disabled' },
    ],
    [
      'a public form',
      sub('owner', 'draft'),
      forms.public,
      anonymous,
      { status: 'denied', code: 'drafts_public' },
    ],
  ])('saveDraftStatusOf: %s', (_label, submission, facts, caller, expected) => {
    expect(saveDraftStatusOf(submission, facts, caller)).toEqual(expected);
  });

  it.each([
    ['allowed', sub('owner', 'opened'), idir, { status: 'allowed' }],
    [
      'access before state',
      sub(null, 'submitted'),
      idir,
      { status: 'denied', code: 'write_denied' },
    ],
    [
      'a submitted submission',
      sub('owner', 'submitted'),
      idir,
      { status: 'closed', code: 'upload_closed' },
    ],
    ['a submission sent back to revise', sub('owner', 'revising'), idir, { status: 'allowed' }],
  ])('uploadStatusOf: %s', (_label, submission, caller, expected) => {
    expect(uploadStatusOf(submission, forms.roles, caller)).toEqual(expected);
  });

  it.each([
    ['allowed', sub('owner', 'draft'), idir, { status: 'allowed' }],
    [
      'a collaborator, before state',
      sub('collaborator', 'submitted'),
      idir,
      { status: 'denied', code: 'delete_denied' },
    ],
    [
      'the public user',
      sub('owner', 'draft'),
      anonymous,
      { status: 'denied', code: 'delete_denied' },
    ],
    [
      'a caller not yet known',
      sub('owner', 'draft'),
      { idpCode: null },
      { status: 'denied', code: 'delete_denied' },
    ],
    [
      'a submitted submission',
      sub('owner', 'submitted'),
      idir,
      { status: 'closed', code: 'delete_closed' },
    ],
    [
      'a submission sent back to revise',
      sub('owner', 'revising'),
      idir,
      { status: 'closed', code: 'delete_closed' },
    ],
  ])('ownDeleteStatusOf: %s', (_label, submission, caller, expected) => {
    expect(ownDeleteStatusOf(submission, caller)).toEqual(expected);
  });

  it.each([
    ['allowed', forms.roles, idir, { status: 'allowed' }],
    [
      'access before publication',
      form({ publishedVersionId: null }),
      idir,
      { status: 'denied', code: 'open_denied' },
    ],
    [
      'no published version',
      forms.rolesUnpublished,
      idir,
      { status: 'closed', code: 'not_published' },
    ],
    ['the public user by audience', forms.public, anonymous, { status: 'allowed' }],
  ])('startStatusOf: %s', (_label, facts, caller, expected) => {
    expect(startStatusOf(facts, caller)).toEqual(expected);
    expect(canStartSubmission(facts, caller)).toBe(expected.status === 'allowed');
  });
});

describe('versionSchemaStatusOf', () => {
  const allowed = { status: 'allowed' };
  const openDenied = { status: 'denied', code: 'open_denied' };
  it.each([
    ['the published version, to a role holder', 'v1', forms.roles, idir, allowed],
    ['the published version, to an admitted audience', 'v1', forms.protectedIdir, idir, allowed],
    [
      'a version that is not the published one',
      'v0',
      forms.roles,
      idir,
      { status: 'closed', code: 'version_not_published' },
    ],
    [
      'the published version, to a caller the audience refuses',
      'v1',
      forms.protectedIdir,
      bceid,
      openDenied,
    ],
    [
      'another version, to a caller who may not start, refused before the version counts',
      'v0',
      forms.protectedIdir,
      bceid,
      openDenied,
    ],
    [
      'the published version, to the public caller on a public form',
      'v1',
      forms.public,
      anonymous,
      allowed,
    ],
    [
      "the published version, to the public caller holding the form's roles",
      'v1',
      forms.roles,
      anonymous,
      openDenied,
    ],
    [
      'any version of a form with none published',
      'v1',
      forms.rolesUnpublished,
      idir,
      { status: 'closed', code: 'not_published' },
    ],
  ])('%s', (_label, versionId, facts, caller, expected) => {
    expect(versionSchemaStatusOf(versionId, facts, caller)).toEqual(expected);
    expect(canReadVersionSchema(versionId, facts, caller)).toBe(expected.status === 'allowed');
  });
});

describe('reviseStatusOf', () => {
  const revisable = form({ permissions: SUBMITTER, allowSubmitterRevision: true });
  const submittedBy = (role: string | null, reviewStatus: SubmitterReviewLabel | null) => ({
    ...sub(role, 'submitted'),
    reviewStatus,
  });

  it.each([
    ['allowed', submittedBy('owner', 'submitted'), revisable, idir, { status: 'allowed' }],
    [
      'a collaborator',
      submittedBy('collaborator', 'submitted'),
      revisable,
      idir,
      { status: 'denied', code: 'revise_denied' },
    ],
    [
      'the public user, never',
      submittedBy('owner', 'submitted'),
      form({ audienceMode: 'public', allowSubmitterRevision: true }),
      anonymous,
      { status: 'denied', code: 'revise_denied' },
    ],
    [
      'an owner who may no longer write',
      submittedBy('owner', 'submitted'),
      form({ allowSubmitterRevision: true }),
      idir,
      { status: 'denied', code: 'revise_denied' },
    ],
    [
      'the setting off',
      submittedBy('owner', 'submitted'),
      form({ permissions: SUBMITTER }),
      idir,
      { status: 'denied', code: 'revise_disabled' },
    ],
    [
      'a reviewer took it up',
      submittedBy('owner', 'inReview'),
      revisable,
      idir,
      { status: 'closed', code: 'revise_closed' },
    ],
    [
      'already sent back',
      { ...sub('owner', 'revising'), reviewStatus: 'revisionRequested' as const },
      revisable,
      idir,
      { status: 'closed', code: 'revise_closed' },
    ],
    [
      'a draft',
      { ...sub('owner', 'draft'), reviewStatus: null },
      revisable,
      idir,
      { status: 'closed', code: 'revise_closed' },
    ],
  ])('%s', (_label, submission, facts, caller, expected) => {
    expect(reviseStatusOf(submission, facts, caller)).toEqual(expected);
    expect(canReviseSubmission(submission, facts, caller)).toBe(expected.status === 'allowed');
  });
});
