/**
 * Who each check admits in the coverage set. A persona left out of a list is refused. Owner cells
 * assume the owner signs in through OWNER_PROVIDER.
 */
import {
  PERSONA_KEYS,
  type CoverageFormKey,
  type CoverageSubmissionKey,
  type CoverageWorkspaceKey,
  type PersonaKey,
} from './plan';

export interface FormExpectation {
  /** In My Forms, and its workspace in the My Forms filter. */
  listed: PersonaKey[];
  /** Opens a new submission: a live form, a published version, and the open rule. */
  start: PersonaKey[];
  /** Saves a draft of a new submission: start, and the form accepts drafts. */
  draft: PersonaKey[];
  /** document_template_read, as the access check answers it. */
  templates: PersonaKey[];
  /** submission_update, as the access check answers it. */
  update: PersonaKey[];
}

/** Design-mode access, as the design routes answer it. */
export interface DesignExpectation {
  /** In the designer's forms list. */
  designListed: PersonaKey[];
  /** form_read on the form: the form, its versions and settings. */
  designRead: PersonaKey[];
  /** design_update on the form. */
  designUpdate: PersonaKey[];
  /** submission_read on the form: its submissions in the designer. */
  submissionsRead: PersonaKey[];
  /** form_read and document_template_read on the form: the staff template list and downloads. */
  staffTemplates: PersonaKey[];
  /** submission_read and submission_print_upload on the form: print with an uploaded template. */
  printUpload: PersonaKey[];
}

/** Workspace access, as the core routes answer it. */
export interface WorkspaceExpectation {
  /** Lists the workspace's members and groups. */
  peopleRead: PersonaKey[];
  /** Offered by the Create Form workspace picker. */
  formCreate: PersonaKey[];
}

export interface SubmissionExpectation {
  /** In My Submissions. */
  mine: PersonaKey[];
  read: PersonaKey[];
  /** The write rule save and submit share. The request can still refuse or hold the write. */
  write: PersonaKey[];
  /** Uploads a file: the write rule, before it is submitted. */
  upload: PersonaKey[];
  /** Deletes a file: the write rule before it is submitted, then submission_update with no grant. */
  fileDelete: PersonaKey[];
  /** Prints it: a grant and document_template_read. */
  render: PersonaKey[];
  /** Deletes it: an owner grant, signed in, before it is submitted. */
  delete: PersonaKey[];
}

export const FORM_CHECKS = ['listed', 'start', 'draft', 'templates', 'update'] as const;
export const DESIGN_CHECKS = [
  'designListed',
  'designRead',
  'designUpdate',
  'submissionsRead',
  'staffTemplates',
  'printUpload',
] as const;
export const WORKSPACE_CHECKS = ['peopleRead', 'formCreate'] as const;
export const SUBMISSION_CHECKS = [
  'mine',
  'read',
  'write',
  'upload',
  'fileDelete',
  'render',
  'delete',
] as const;

export type FormCheck = (typeof FORM_CHECKS)[number];
export type DesignCheck = (typeof DESIGN_CHECKS)[number];
export type WorkspaceCheck = (typeof WORKSPACE_CHECKS)[number];
export type SubmissionCheck = (typeof SUBMISSION_CHECKS)[number];

/** One persona's answers on one case. */
export interface CaseResult<TCase extends string, TCheck extends string> {
  persona: PersonaKey;
  caseKey: TCase;
  actual: Record<TCheck, boolean>;
  expected: Record<TCheck, boolean>;
}

/** Whether the table admits the persona, per check. */
export const expectedOf = <TCheck extends string>(
  checks: readonly TCheck[],
  table: Record<TCheck, readonly PersonaKey[]>,
  persona: PersonaKey,
): Record<TCheck, boolean> =>
  Object.fromEntries(checks.map((check) => [check, table[check].includes(persona)])) as Record<
    TCheck,
    boolean
  >;

/** Cells whose answer differs from the table. */
export const mismatchesOf = <TCase extends string, TCheck extends string>(
  results: CaseResult<TCase, TCheck>[],
): Array<{ persona: PersonaKey; caseKey: TCase; check: TCheck; expected: boolean }> =>
  results.flatMap((result) =>
    (Object.keys(result.expected) as TCheck[])
      .filter((check) => result.expected[check] !== result.actual[check])
      .map((check) => ({
        persona: result.persona,
        caseKey: result.caseKey,
        check,
        expected: result.expected[check],
      })),
  );

const EVERYONE: PersonaKey[] = [...PERSONA_KEYS];

/** Everyone signing in through IDIR. */
const IDIR: PersonaKey[] = EVERYONE.filter((p) => p !== 'bceidOutsider' && p !== 'anonymous');

/** Effective form_submitter role holders in the roles workspace, without an override. */
const ROLE_SUBMITTERS: PersonaKey[] = ['owner', 'submitter', 'overrideRemoved'];

const ROLES_STAFF_UPDATE: PersonaKey[] = ['admin', 'reviewer'];

const rolesInherited = (): FormExpectation => ({
  listed: ROLE_SUBMITTERS,
  start: ['admin', ...ROLE_SUBMITTERS],
  draft: ['admin', ...ROLE_SUBMITTERS],
  templates: ['admin', ...ROLE_SUBMITTERS],
  update: ROLES_STAFF_UPDATE,
});

/** The access check reads roles, not whether the form or its version still exists. */
const rolesUnlisted = (): FormExpectation => ({
  listed: [],
  start: [],
  draft: [],
  templates: ['admin', ...ROLE_SUBMITTERS],
  update: ROLES_STAFF_UPDATE,
});

export const FORM_EXPECTATIONS: Record<CoverageFormKey, FormExpectation> = {
  rolesInherit: rolesInherited(),
  rolesOverride: {
    listed: ['submitter', 'overrideAdded'],
    start: ['admin', 'submitter', 'overrideAdded'],
    draft: ['admin', 'submitter', 'overrideAdded'],
    templates: ['admin', 'submitter', 'overrideAdded'],
    update: ROLES_STAFF_UPDATE,
  },
  rolesOverrideCleared: rolesInherited(),
  rolesDesignersOverride: rolesInherited(),
  rolesUnpublished: rolesUnlisted(),
  rolesFormDeleted: rolesUnlisted(),
  rolesVersionDeleted: rolesUnlisted(),
  rolesVersionReplaced: rolesInherited(),
  rolesDraftsOff: {
    listed: ROLE_SUBMITTERS,
    start: ['admin', ...ROLE_SUBMITTERS],
    draft: [],
    templates: ['admin', ...ROLE_SUBMITTERS],
    update: ROLES_STAFF_UPDATE,
  },
  protectedInherit: {
    listed: ['outsider'],
    start: IDIR,
    draft: [],
    templates: IDIR,
    update: ['admin', 'owner'],
  },
  publicOwn: {
    listed: [],
    start: EVERYONE,
    draft: [],
    templates: EVERYONE,
    update: ['admin', 'owner'],
  },
  bceidOwn: {
    listed: [],
    start: ['admin', 'owner', 'bceidOutsider'],
    draft: ['admin', 'owner', 'bceidOutsider'],
    templates: ['admin', 'owner', 'bceidOutsider'],
    update: ['admin', 'owner'],
  },
  membersOwn: {
    listed: [],
    start: ['admin', 'owner'],
    draft: ['admin', 'owner'],
    templates: ['admin', 'owner'],
    update: ['admin', 'owner'],
  },
  publicInherit: {
    listed: [],
    start: EVERYONE,
    draft: [],
    templates: EVERYONE,
    update: ['admin'],
  },
  protectedOwn: {
    listed: ['outsider', 'collaborator', 'bceidOutsider', 'owner'],
    start: IDIR,
    draft: IDIR,
    templates: IDIR,
    update: ['admin'],
  },
};

/** form_read in the roles workspace without an override: the staff groups. */
const ROLES_READERS: PersonaKey[] = ['admin', 'designer', 'reviewer', 'viewer'];

/** submission_read in the roles workspace: admin, the reviewers and the approvers. */
const ROLES_SUBMISSION_READERS: PersonaKey[] = ['admin', 'reviewer', 'viewer'];

const rolesDesign = (changes: Partial<DesignExpectation> = {}): DesignExpectation => ({
  designListed: ROLES_READERS,
  designRead: ROLES_READERS,
  designUpdate: ['admin', 'designer'],
  submissionsRead: ROLES_SUBMISSION_READERS,
  staffTemplates: ['admin'],
  printUpload: ROLES_SUBMISSION_READERS,
  ...changes,
});

const everyCheck = (personas: PersonaKey[]): DesignExpectation => ({
  designListed: personas,
  designRead: personas,
  designUpdate: personas,
  submissionsRead: personas,
  staffTemplates: personas,
  printUpload: personas,
});

const DESIGNERS_OVERRIDE_READERS: PersonaKey[] = ['admin', 'reviewer', 'viewer', 'overrideAdded'];

export const DESIGN_EXPECTATIONS: Record<CoverageFormKey, DesignExpectation> = {
  rolesInherit: rolesDesign(),
  rolesOverride: rolesDesign(),
  rolesOverrideCleared: rolesDesign(),
  rolesDesignersOverride: rolesDesign({
    designListed: DESIGNERS_OVERRIDE_READERS,
    designRead: DESIGNERS_OVERRIDE_READERS,
    designUpdate: ['admin', 'overrideAdded'],
  }),
  rolesUnpublished: rolesDesign(),
  // A deleted form's routes return 404 before any permission check.
  rolesFormDeleted: everyCheck([]),
  rolesVersionDeleted: rolesDesign(),
  rolesVersionReplaced: rolesDesign(),
  rolesDraftsOff: rolesDesign(),
  protectedInherit: everyCheck(['admin', 'owner']),
  publicOwn: everyCheck(['admin', 'owner']),
  bceidOwn: everyCheck(['admin', 'owner']),
  membersOwn: everyCheck(['admin', 'owner']),
  publicInherit: everyCheck(['admin']),
  protectedOwn: everyCheck(['admin']),
};

/**
 * People: every active member but a viewer; the public user never signs in to the core routes.
 * Create: form_admin through an active group, the only role holding form_create.
 */
export const WORKSPACE_EXPECTATIONS: Record<CoverageWorkspaceKey, WorkspaceExpectation> = {
  roles: {
    peopleRead: [
      'admin',
      'owner',
      'submitter',
      'designer',
      'reviewer',
      'overrideRemoved',
      'overrideAdded',
      'inactiveGroupMember',
      'inactiveGroup',
    ],
    formCreate: ['admin'],
  },
  audience: { peopleRead: ['admin', 'owner'], formCreate: ['admin', 'owner'] },
  public: { peopleRead: ['admin'], formCreate: ['admin'] },
};

const NONE: SubmissionExpectation = {
  mine: [],
  read: [],
  write: [],
  upload: [],
  fileDelete: [],
  render: [],
  delete: [],
};

/** Every check but mine and delete for the caller who opened it, on an in-progress submission. */
const inProgressFor = (persona: PersonaKey) => ({
  read: [persona],
  write: [persona],
  upload: [persona],
  fileDelete: [persona],
  render: [persona],
});

export const SUBMISSION_EXPECTATIONS: Record<CoverageSubmissionKey, SubmissionExpectation> = {
  // The IDIR audience refuses the BCeID collaborator everything but the read.
  outsiderDraft: {
    mine: ['outsider', 'collaborator', 'bceidOutsider'],
    read: ['outsider', 'collaborator', 'bceidOutsider'],
    write: ['outsider', 'collaborator'],
    upload: ['outsider', 'collaborator'],
    fileDelete: ['outsider', 'collaborator'],
    render: ['outsider', 'collaborator'],
    delete: ['outsider'],
  },
  // Once submitted, only the form administrators delete a file, without a grant.
  outsiderSubmitted: {
    mine: ['outsider'],
    read: ['outsider'],
    write: ['outsider'],
    upload: [],
    fileDelete: ['owner', 'admin'],
    render: ['outsider'],
    delete: [],
  },
  outsiderOpened: { mine: [], ...inProgressFor('outsider'), delete: ['outsider'] },
  bceidDeleted: NONE,
  // A deleted form or form version closes the submissions on it.
  submitterOnDeletedVersion: NONE,
  submitterOnDeletedForm: NONE,
  ownerDraft: { mine: ['owner'], ...inProgressFor('owner'), delete: ['owner'] },
  // The submitter role grants the write and the render; the members audience admits no one else.
  submitterDraft: { mine: ['submitter'], ...inProgressFor('submitter'), delete: ['submitter'] },
  // A reviewer sent it back: its submitter edits it as in progress, but cannot delete it.
  submitterRevising: { mine: ['submitter'], ...inProgressFor('submitter'), delete: [] },
  // A version published after it does not close it; it stays on its own version.
  submitterOnReplacedVersion: {
    mine: ['submitter'],
    ...inProgressFor('submitter'),
    delete: ['submitter'],
  },
  // The public user owns every anonymous submission, so any anonymous caller holding the id passes.
  anonymousSubmitted: {
    mine: [],
    read: ['anonymous'],
    write: ['anonymous'],
    upload: [],
    fileDelete: ['admin'],
    render: ['anonymous'],
    delete: [],
  },
  anonymousOpened: { mine: [], ...inProgressFor('anonymous'), delete: [] },
};
