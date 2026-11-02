/**
 * Runs every coverage case through the code the submit, design and workspace routes use, and
 * compares the answers with the expectations table. Reads only.
 */
import { isDeepStrictEqual } from 'node:util';
import { and, eq, inArray } from 'drizzle-orm';
import {
  audienceAdmits,
  canContinueSubmission,
  canDeleteOwnSubmission,
  canReadVersionSchema,
  canSaveSubmissionDraft,
  canStartSubmission,
  DEFAULT_SORT_LOCALE,
  DraftSaveStatus,
  draftSaveStatusOf,
  hasAllPermissions,
  isIdentifiedCaller,
  isSubmissionEditable,
  isSubmissionInProgress,
  Permissions,
  PUBLIC_PROVIDER_CODE,
  SubmissionParticipantRole,
  type PermissionCode,
  type SubmissionAccessFacts,
} from '@soba/lib';

import { db } from '../../../core/db/client';
import { FormCreatePermissions, PrintUploadPermissions } from '../../../core/db/codes';
import type { IdpAttributes } from '../../../core/auth/jwtClaims';
import {
  forms,
  formVersions,
  identityProviders,
  sobaAdmins,
  submissionParticipants,
  submissions,
  userIdentities,
} from '../../../core/db/schema';
import {
  resolveFormAccessGrant,
  resolveFormPermissions,
  resolveWorkspacePermissions,
  type FormAccessGrant,
} from '../../../core/db/repos/formAccessRepo';
import { getWorkspaceIdForForm, listFormsForWorkspace } from '../../../core/db/repos/formRepo';
import { findSignInState } from '../../../core/db/repos/identityLookup';
import {
  findActorMembership,
  getActiveWorkspaceIdsForUser,
  isWorkspacePeopleReadRole,
  lookupWorkspacesForUser,
} from '../../../core/db/repos/membershipRepo';
import {
  hasFormSubmitAccess,
  type CallerIdentity,
} from '../../../core/db/repos/formSubmitAccessRepo';
import {
  getFormVersionListContext,
  getPublishedVersionForForm,
  listFormVersionsForWorkspace,
} from '../../../core/db/repos/formVersionRepo';
import {
  findLiveSubmissionRecord,
  getSubmissionById,
  getSubmissionListContext,
  getSubmissionWorkspaceAndState,
  listSubmissionsForParticipant,
  listSubmissionsForWorkspace,
  type ParticipantSubmissionListRow,
} from '../../../core/db/repos/submissionRepo';
import {
  findLiveSubmitterForm,
  findSubmitterFormFacts,
  findSubmitterFormVersion,
  listFormsForSubmitter,
  listSubmitterForms,
  listWorkspacesForSubmitter,
  type SubmitterFormListRow,
} from '../../../core/db/repos/submitterFormRepo';
import {
  isActiveOwner,
  isActiveParticipant,
} from '../../../core/db/repos/submissionParticipantRepo';
import { findSubmitterSubmission } from '../../../core/db/repos/submitterSubmissionRepo';
import { isSubmitterAllowed, SubmitterOperation } from '../../../core/services/submitterAccess';
import { toSubmissionDto } from '../../../core/api/submissions/serviceFactory';
import { ValidationError } from '../../../core/errors';
import { mapInOrder } from '../../../core/inOrder';
import { getDraftSaveStatus } from '../../form-settings/submitter/drafts';
import { findActiveManifest } from '../runs';
import {
  DESIGN_CHECKS,
  DESIGN_EXPECTATIONS,
  expectedOf,
  FORM_CHECKS,
  FORM_EXPECTATIONS,
  SUBMISSION_CHECKS,
  SUBMISSION_EXPECTATIONS,
  WORKSPACE_CHECKS,
  WORKSPACE_EXPECTATIONS,
  type CaseResult,
  type DesignCheck,
  type FormCheck,
  type SubmissionCheck,
  type WorkspaceCheck,
} from './expectations';
import type { CoverageFormRef, CoverageManifest, CoverageSubmissionRef } from './generate';
import {
  ANONYMOUS,
  buildCoveragePlan,
  COVERAGE_FORM_KEYS,
  COVERAGE_PREFIX,
  COVERAGE_SUBMISSION_KEYS,
  COVERAGE_WORKSPACE_KEYS,
  OWNER,
  OWNER_PROVIDER,
  PERSONA_KEYS,
  type CoverageFormKey,
  type CoverageSubmissionKey,
  type CoverageWorkspaceKey,
  type PersonaKey,
  type PlannedDelete,
} from './plan';

export interface CoverageReport {
  /** Personas whose cases were checked. */
  personas: PersonaKey[];
  /** Why a persona was left out. */
  skipped: string[];
  forms: CaseResult<CoverageFormKey, FormCheck>[];
  design: CaseResult<CoverageFormKey, DesignCheck>[];
  workspaces: CaseResult<CoverageWorkspaceKey, WorkspaceCheck>[];
  submissions: CaseResult<CoverageSubmissionKey, SubmissionCheck>[];
  /** Disagreements between code paths that should give the same answer, or with the seeded rows. */
  inconsistencies: string[];
}

/** Results for a group of cases, and where two code paths disagreed on them. */
interface CaseCheck<TCase extends string, TCheck extends string> {
  results: CaseResult<TCase, TCheck>[];
  issues: string[];
}

interface Caller {
  persona: PersonaKey;
  identity: CallerIdentity;
  /** A signed-in caller with lists of their own. */
  signedIn: boolean;
}

const MAX_ROWS = 1000;

const REQUIRES_SEED = 'No dev data with a coverage set here; run pnpm db:dev-data --reset';

const OUT_OF_DATE = 'The coverage set predates this plan; run pnpm db:dev-data --reset';

const hasKeys = (record: object | undefined, keys: readonly string[]): boolean =>
  !!record && keys.every((key) => key in record);

/** The seeded set, refused when it lacks a case the plan now has. */
export async function loadCoverageManifest(): Promise<CoverageManifest> {
  const manifest = (await findActiveManifest()) as { coverage?: Partial<CoverageManifest> } | null;
  const coverage = manifest?.coverage;
  if (!coverage) throw new ValidationError(REQUIRES_SEED);
  const current =
    hasKeys(coverage.personas, PERSONA_KEYS) &&
    hasKeys(coverage.workspaces, COVERAGE_WORKSPACE_KEYS) &&
    hasKeys(coverage.forms, COVERAGE_FORM_KEYS) &&
    hasKeys(coverage.submissions, COVERAGE_SUBMISSION_KEYS);
  if (!current) throw new ValidationError(OUT_OF_DATE);
  return coverage as CoverageManifest;
}

const callerOf = (manifest: CoverageManifest, persona: PersonaKey): Caller => {
  const ref = manifest.personas[persona];
  const identity = { actorId: ref.id, idpCode: ref.identityProviderCode };
  return { persona, identity, signedIn: isIdentifiedCaller(identity) };
};

/** The caller's user id when they are signed in; null for the public user. */
const signedInActorId = (caller: Caller): string | null =>
  caller.signedIn ? (caller.identity.actorId ?? null) : null;

/** My Forms rows in the workspace, by form id. */
async function myFormRows(
  caller: Caller,
  workspaceId: string,
): Promise<Map<string, SubmitterFormListRow>> {
  const actorId = signedInActorId(caller);
  if (!actorId) return new Map();
  const { items } = await listFormsForSubmitter({
    userId: actorId,
    offset: 0,
    limit: MAX_ROWS,
    workspaceId,
    sort: 'name:asc',
    locale: DEFAULT_SORT_LOCALE,
  });
  return new Map(items.map((row) => [row.id, row]));
}

async function myWorkspaceIds(caller: Caller): Promise<Set<string>> {
  const actorId = signedInActorId(caller);
  if (!actorId) return new Set();
  const rows = await listWorkspacesForSubmitter({
    userId: actorId,
    limit: MAX_ROWS,
    locale: DEFAULT_SORT_LOCALE,
  });
  return new Set(rows.map((row) => row.id));
}

/** My Submissions rows by submission id, and the forms read with them by form id. */
interface MySubmissions {
  rows: Map<string, ParticipantSubmissionListRow>;
  forms: Map<string, SubmitterFormListRow>;
}

async function mySubmissionRows(caller: Caller): Promise<MySubmissions> {
  const actorId = signedInActorId(caller);
  if (!actorId) return { rows: new Map(), forms: new Map() };
  const { items, forms: pageForms } = await listSubmissionsForParticipant({
    userId: actorId,
    offset: 0,
    limit: MAX_ROWS,
    sort: 'createdAt:desc',
    locale: DEFAULT_SORT_LOCALE,
  });
  return {
    rows: new Map(items.map((row) => [row.id, row])),
    forms: new Map(pageForms.map((form) => [form.id, form])),
  };
}

/** My Forms rows across every workspace, by form id. */
async function allMyFormRows(caller: Caller): Promise<Map<string, SubmitterFormListRow>> {
  const actorId = signedInActorId(caller);
  if (!actorId) return new Map();
  const { items } = await listFormsForSubmitter({
    userId: actorId,
    offset: 0,
    limit: MAX_ROWS,
    sort: 'name:asc',
    locale: DEFAULT_SORT_LOCALE,
  });
  return new Map(items.map((row) => [row.id, row]));
}

async function formAnswers(
  caller: Caller,
  form: CoverageFormRef,
): Promise<Omit<Record<FormCheck, boolean>, 'listed'>> {
  const target = { workspaceId: form.workspaceId, formId: form.formId };
  const live = (await getWorkspaceIdForForm(form.formId)) !== null;
  const published =
    live && (await getPublishedVersionForForm(form.workspaceId, form.formId)) !== null;
  const start =
    published && (await isSubmitterAllowed(SubmitterOperation.open, target, caller.identity));
  const draft =
    start &&
    (await getDraftSaveStatus(
      { workspaceId: form.workspaceId, actorDisplayLabel: null },
      form.formId,
    )) === DraftSaveStatus.allowed;
  return {
    start,
    draft,
    templates: await hasFormSubmitAccess(
      target,
      caller.identity,
      Permissions.document_template_read,
    ),
    update: await hasFormSubmitAccess(target, caller.identity, Permissions.submission_update),
  };
}

async function submissionAnswers(
  caller: Caller,
  ref: CoverageSubmissionRef,
  mine: Map<string, SubmissionAccessFacts>,
): Promise<Record<SubmissionCheck, boolean>> {
  const live = await getSubmissionWorkspaceAndState(ref.submissionId);
  const allows = async (operation: keyof typeof SubmitterOperation) =>
    !!live && isSubmitterAllowed(SubmitterOperation[operation], ref, caller.identity);
  const deletable =
    !!live && isSubmissionInProgress(live.workflowState) && (await allows('delete'));
  return {
    mine: mine.has(ref.submissionId),
    read: await allows('read'),
    write: await allows('write'),
    upload: await allows('upload'),
    fileDelete: await allows('deleteFile'),
    render: await allows('render'),
    delete: deletable,
  };
}

/** The My Forms row's own Start and Save draft must match what the routes allow. */
function rowInconsistencies(
  caller: Caller,
  formKey: CoverageFormKey,
  row: SubmitterFormListRow,
  answers: { start: boolean; draft: boolean },
): string[] {
  const issues: string[] = [];
  const idp = { idpCode: caller.identity.idpCode };
  if (canStartSubmission(row, idp) !== answers.start) {
    issues.push(`${caller.persona} x ${formKey}: My Forms row start differs from the open route`);
  }
  if (canSaveSubmissionDraft(row, idp) !== answers.draft) {
    issues.push(`${caller.persona} x ${formKey}: My Forms row draft differs from the drafts rule`);
  }
  return issues;
}

/** Answers for one persona and one form, read alongside the My Forms rows of its workspace. */
async function checkForm(
  manifest: CoverageManifest,
  caller: Caller,
  formKey: CoverageFormKey,
  rows: Map<string, SubmitterFormListRow>,
): Promise<{ result: CaseResult<CoverageFormKey, FormCheck>; issues: string[] }> {
  const form = manifest.forms[formKey];
  const row = rows.get(form.formId);
  const answers = await formAnswers(caller, form);
  return {
    result: {
      persona: caller.persona,
      caseKey: formKey,
      actual: { listed: !!row, ...answers },
      expected: expectedOf(FORM_CHECKS, FORM_EXPECTATIONS[formKey], caller.persona),
    },
    issues: [
      ...(row ? rowInconsistencies(caller, formKey, row, answers) : []),
      ...(await openReadIssues(caller, formKey, form, answers.start)),
      ...(await versionSchemaIssues(caller, formKey, form, answers.start)),
    ],
  };
}

/** The user whose form permissions the submit reads count: none for the public user. */
const factsUserId = ({ identity }: Caller): string | null =>
  identity.actorId && identity.idpCode !== PUBLIC_PROVIDER_CODE ? identity.actorId : null;

/**
 * The open route and the form read decide from one read of the form; Start from it must match the
 * open rules.
 */
async function openReadIssues(
  caller: Caller,
  formKey: CoverageFormKey,
  form: CoverageFormRef,
  start: boolean,
): Promise<string[]> {
  const read = await findLiveSubmitterForm({ userId: factsUserId(caller), formId: form.formId });
  const fromRead = !!read && canStartSubmission(read, caller.identity);
  return fromRead === start
    ? []
    : [
        `${caller.persona} x ${formKey}: Start from the open route's read differs from the open rules`,
      ];
}

/**
 * The version schema read, from its own read of each of the form's versions, admits the caller to
 * the published version exactly when they may start, and to no other version.
 */
async function versionSchemaIssues(
  caller: Caller,
  formKey: CoverageFormKey,
  form: CoverageFormRef,
  start: boolean,
): Promise<string[]> {
  const versions = await db
    .select({ id: formVersions.id, versionNo: formVersions.versionNo })
    .from(formVersions)
    .where(eq(formVersions.formId, form.formId));
  const published = await getPublishedVersionForForm(form.workspaceId, form.formId);
  const issues = await Promise.all(
    versions.map(async (version) => {
      const read = await findSubmitterFormVersion({
        userId: factsUserId(caller),
        formVersionId: version.id,
      });
      const admits = !!read && canReadVersionSchema(version.id, read.form, caller.identity);
      return admits === (start && version.id === published?.id)
        ? []
        : [
            `${caller.persona} x ${formKey}: schema read of version ${version.versionNo} (${version.id === published?.id ? 'published' : 'not published'}) ${admits ? 'admits' : 'refuses'} where the start rules ${start ? 'allow' : 'refuse'}`,
          ];
    }),
  );
  return issues.flat();
}

/** The keys of the coverage forms in `workspaceId`. */
const formKeysIn = (manifest: CoverageManifest, workspaceId: string): CoverageFormKey[] =>
  COVERAGE_FORM_KEYS.filter((key) => manifest.forms[key].workspaceId === workspaceId);

const formKeyOf = (manifest: CoverageManifest, formId: string): string =>
  COVERAGE_FORM_KEYS.find((key) => manifest.forms[key].formId === formId) ?? formId;

/** A design list's rows in `workspaceIds` under `formAccess`, as the form id of each. */
type DesignListFormIds = (workspaceIds: string[], formAccess: FormAccessGrant) => Promise<string[]>;

const designFormsList: DesignListFormIds = async (workspaceIds, formAccess) => {
  const { items } = await listFormsForWorkspace({
    workspaceIds,
    formAccess,
    offset: 0,
    limit: MAX_ROWS,
    sort: 'name:asc',
    locale: DEFAULT_SORT_LOCALE,
  });
  return items.map((item) => item.id);
};

/** The design lists, each with the code sets it is run under. */
const DESIGN_LISTS: readonly {
  name: string;
  formIds: DesignListFormIds;
  codeSets: readonly (readonly PermissionCode[])[];
  /** Planned deletes that leave every row of the form out of the list. */
  hides: readonly PlannedDelete[];
}[] = [
  {
    name: 'forms',
    formIds: designFormsList,
    codeSets: [
      [Permissions.form_read],
      [Permissions.submission_read],
      [Permissions.design_update],
      [Permissions.form_read, Permissions.document_template_read],
    ],
    hides: ['deleteForm'],
  },
  {
    name: 'form versions',
    formIds: async (workspaceIds, formAccess) => {
      const { items } = await listFormVersionsForWorkspace({
        workspaceIds,
        formAccess,
        offset: 0,
        limit: MAX_ROWS,
        sort: 'versionNo:desc',
      });
      return items.map((item) => item.formId);
    },
    codeSets: [[Permissions.form_read]],
    hides: ['deleteForm', 'deleteVersion'],
  },
  {
    name: 'submissions',
    formIds: async (workspaceIds, formAccess) => {
      const { items } = await listSubmissionsForWorkspace({
        workspaceIds,
        formAccess,
        offset: 0,
        limit: MAX_ROWS,
        sort: 'updatedAt:desc',
        locale: DEFAULT_SORT_LOCALE,
      });
      return items.map((item) => item.formId);
    },
    codeSets: [[Permissions.submission_read]],
    hides: ['deleteForm', 'deleteVersion'],
  },
];

/**
 * A grant that passes the workspace's coverage forms by id alone, so a list read with it shares no
 * filter path with an actor's workspace-wide grant.
 */
const coverageFormsGrant = (manifest: CoverageManifest, workspaceId: string): FormAccessGrant => ({
  workspaceIds: [],
  overriddenFormIds: [],
  includedFormIds: formKeysIn(manifest, workspaceId).map((key) => manifest.forms[key].formId),
});

/** Ids in exactly one of `a` and `b`. */
const differing = (a: ReadonlySet<string>, b: ReadonlySet<string>): string[] =>
  [...new Set([...a, ...b])].filter((id) => a.has(id) !== b.has(id));

/**
 * Under the actor's grant, each design list must hold exactly the forms, of those it lists under
 * coverageFormsGrant, whose own check grants the codes.
 */
async function designListInconsistencies(
  manifest: CoverageManifest,
  persona: PersonaKey,
  actorId: string,
  workspaceKey: CoverageWorkspaceKey,
  permissions: ReadonlyMap<string, ReadonlySet<string>>,
): Promise<string[]> {
  const workspaceIds = [manifest.workspaces[workspaceKey].id];
  const fullLists = await Promise.all(
    DESIGN_LISTS.map((list) =>
      list.formIds(workspaceIds, coverageFormsGrant(manifest, workspaceIds[0])),
    ),
  );
  const cases = DESIGN_LISTS.flatMap((list, index) =>
    list.codeSets.map((required) => ({ list, required, full: fullLists[index] })),
  );
  const issues = await Promise.all(
    cases.map(async ({ list, required, full }) => {
      const grant = await resolveFormAccessGrant(actorId, required, workspaceIds);
      const listed = new Set(await list.formIds(workspaceIds, grant));
      const expected = new Set(
        full.filter((formId) => hasAllPermissions(permissions.get(formId) ?? [], required)),
      );
      return differing(listed, expected).map(
        (formId) =>
          `${persona} x ${formKeyOf(manifest, formId)}: ${list.name} list for ${required.join('+')} differs from the form check`,
      );
    }),
  );
  return issues.flat();
}

/** Each coverage form's planned delete, by form key. */
const PLANNED_DELETES: ReadonlyMap<string, PlannedDelete> = new Map(
  buildCoveragePlan()
    .workspaces.flatMap((workspace) => workspace.forms)
    .flatMap(({ key, afterSubmissions }) =>
      afterSubmissions === 'deleteForm' || afterSubmissions === 'deleteVersion'
        ? [[key, afterSubmissions] as const]
        : [],
    ),
);

/** No design list, read with coverageFormsGrant, shows a form whose planned delete it hides. */
async function deletedRowsShown(manifest: CoverageManifest): Promise<string[]> {
  const reads = COVERAGE_WORKSPACE_KEYS.flatMap((workspaceKey) =>
    DESIGN_LISTS.map((list) => ({ workspaceId: manifest.workspaces[workspaceKey].id, list })),
  );
  const issues = await Promise.all(
    reads.map(async ({ workspaceId, list }) => {
      const shown = await list.formIds([workspaceId], coverageFormsGrant(manifest, workspaceId));
      return [...new Set(shown)].flatMap((formId) => {
        const key = formKeyOf(manifest, formId);
        const planned = PLANNED_DELETES.get(key);
        return planned && list.hides.includes(planned)
          ? [`${key}: ${list.name} list shows it after ${planned}`]
          : [];
      });
    }),
  );
  return issues.flat();
}

/**
 * Each coverage form version and submission resolves by id exactly when it and the records it
 * belongs to are not deleted, as their own rows say.
 */
async function lookupInconsistencies(manifest: CoverageManifest): Promise<string[]> {
  const versions = await db
    .select({
      id: formVersions.id,
      formId: formVersions.formId,
      deletedAt: formVersions.deletedAt,
      formDeletedAt: forms.deletedAt,
    })
    .from(formVersions)
    .innerJoin(forms, eq(forms.id, formVersions.formId))
    .where(
      inArray(
        formVersions.formId,
        COVERAGE_FORM_KEYS.map((key) => manifest.forms[key].formId),
      ),
    );
  const submissionKeys = new Map(
    COVERAGE_SUBMISSION_KEYS.map((key) => [manifest.submissions[key].submissionId, key]),
  );
  const submissionRows = await db
    .select({
      id: submissions.id,
      deletedAt: submissions.deletedAt,
      formDeletedAt: forms.deletedAt,
      versionDeletedAt: formVersions.deletedAt,
    })
    .from(submissions)
    .innerJoin(forms, eq(forms.id, submissions.formId))
    .innerJoin(formVersions, eq(formVersions.id, submissions.formVersionId))
    .where(inArray(submissions.id, [...submissionKeys.keys()]));

  const versionIssues = await Promise.all(
    versions.map(async (row) => {
      const live = row.deletedAt === null && row.formDeletedAt === null;
      const resolves = (await getFormVersionListContext(row.id)) !== null;
      return live === resolves
        ? []
        : [
            `${formKeyOf(manifest, row.formId)} version ${row.id}: lookup by id disagrees with deletedAt`,
          ];
    }),
  );
  const submissionIssues = await Promise.all(
    submissionRows.map(async (row) => {
      const live =
        row.deletedAt === null && row.formDeletedAt === null && row.versionDeletedAt === null;
      const lookups = [
        (await getSubmissionListContext(row.id)) !== null,
        (await getSubmissionWorkspaceAndState(row.id)) !== null,
        (await findLiveSubmissionRecord(row.id)) !== null,
      ];
      return lookups.every((resolves) => resolves === live)
        ? []
        : [`${submissionKeys.get(row.id)}: lookup by id disagrees with deletedAt`];
    }),
  );
  return [...versionIssues.flat(), ...submissionIssues.flat()];
}

/** A stored identity row, its user's admin source, and the persona it belongs to. */
interface StoredIdentity {
  persona: string;
  id: string;
  userId: string;
  providerCode: string;
  providerActive: boolean;
  subject: string;
  attributes: IdpAttributes | null;
  adminSource: string | null;
}

/** Whether the sign-in read gives back what the identity's own rows hold. */
async function signInAgrees(row: StoredIdentity): Promise<boolean> {
  const stored = row.attributes ?? {};
  const read = (attributes: IdpAttributes) =>
    findSignInState(row.providerCode, row.subject, attributes);
  const [state, reversed, changed] = await Promise.all([
    read(stored),
    read(Object.fromEntries(Object.entries(stored).reverse())),
    read({ ...stored, coverageProbe: true }),
  ]);
  const current = row.attributes !== null;
  return (
    state?.providerActive === row.providerActive &&
    state.identityId === row.id &&
    state.userId === row.userId &&
    (state.admin?.source ?? null) === row.adminSource &&
    state.attributesCurrent === current &&
    reversed?.attributesCurrent === current &&
    changed?.attributesCurrent === false
  );
}

/**
 * The sign-in read finds each signed-in persona's identity, user and platform admin row, compares
 * attributes as jsonb, and finds nothing for an unknown subject or provider.
 */
async function signInInconsistencies(manifest: CoverageManifest): Promise<string[]> {
  const personaOf = new Map<string, string>(
    PERSONA_KEYS.filter((key) => key !== ANONYMOUS).map((key) => [manifest.personas[key].id, key]),
  );
  const identities = await db
    .select({
      id: userIdentities.id,
      userId: userIdentities.userId,
      providerCode: userIdentities.identityProviderCode,
      providerActive: identityProviders.isActive,
      subject: userIdentities.subject,
      attributes: userIdentities.idpAttributes,
      adminSource: sobaAdmins.source,
    })
    .from(userIdentities)
    .innerJoin(identityProviders, eq(identityProviders.code, userIdentities.identityProviderCode))
    .leftJoin(sobaAdmins, eq(sobaAdmins.userId, userIdentities.userId))
    .where(inArray(userIdentities.userId, [...personaOf.keys()]));
  const issues = await Promise.all(
    identities.map(async (identity) => {
      const row = {
        ...identity,
        persona: personaOf.get(identity.userId) ?? identity.userId,
        attributes: identity.attributes as IdpAttributes | null,
      };
      return (await signInAgrees(row))
        ? []
        : [`${row.persona}: the sign-in read disagrees with the stored identity`];
    }),
  );
  const ownerProvider = manifest.personas[OWNER].identityProviderCode;
  const [unknownSubject, unknownProvider] = await Promise.all([
    findSignInState(ownerProvider, `${COVERAGE_PREFIX}unknown-subject`, {}),
    findSignInState(`${COVERAGE_PREFIX}unknown-provider`, 'unknown', {}),
  ]);
  const unknowns =
    unknownSubject?.identityId === null && unknownProvider === null
      ? []
      : ['the sign-in read finds an identity for an unknown subject or provider'];
  return [...issues.flat(), ...unknowns];
}

async function checkWorkspaceForms(
  manifest: CoverageManifest,
  caller: Caller,
  workspaceKey: CoverageWorkspaceKey,
  filter: Set<string>,
): Promise<CaseCheck<CoverageFormKey, FormCheck>> {
  const workspaceId = manifest.workspaces[workspaceKey].id;
  const rows = await myFormRows(caller, workspaceId);
  const checked = await Promise.all(
    formKeysIn(manifest, workspaceId).map((formKey) => checkForm(manifest, caller, formKey, rows)),
  );
  const listedHere = rows.size > 0;
  const filterIssue =
    listedHere === filter.has(workspaceId)
      ? []
      : [`${caller.persona} x ${workspaceKey}: My Forms filter disagrees with the listed forms`];
  return {
    results: checked.map((c) => c.result),
    issues: [...checked.flatMap((c) => c.issues), ...filterIssue],
  };
}

async function checkForms(
  manifest: CoverageManifest,
  caller: Caller,
): Promise<CaseCheck<CoverageFormKey, FormCheck>> {
  const filter = await myWorkspaceIds(caller);
  const workspaces = await Promise.all(
    COVERAGE_WORKSPACE_KEYS.map((key) => checkWorkspaceForms(manifest, caller, key, filter)),
  );
  return {
    results: workspaces.flatMap((w) => w.results),
    issues: workspaces.flatMap((w) => w.issues),
  };
}

/** The designer's forms list, across the coverage workspaces the actor is an active member of. */
async function coverageDesignList(
  manifest: CoverageManifest,
  actorId: string,
): Promise<Set<string>> {
  const coverage = new Set(COVERAGE_WORKSPACE_KEYS.map((key) => manifest.workspaces[key].id));
  const workspaceIds = (await getActiveWorkspaceIdsForUser(actorId)).filter((id) =>
    coverage.has(id),
  );
  const grant = await resolveFormAccessGrant(actorId, [Permissions.form_read], workspaceIds);
  return new Set(await designFormsList(workspaceIds, grant));
}

/** The actor's codes on the form as its design routes see them: none once the form is deleted. */
async function designPermissions(actorId: string, form: CoverageFormRef): Promise<Set<string>> {
  if ((await getWorkspaceIdForForm(form.formId)) === null) return new Set();
  return resolveFormPermissions(actorId, form.workspaceId, form.formId);
}

/** The actor's design permissions on each coverage form, by form id. */
async function coverageFormPermissions(
  manifest: CoverageManifest,
  actorId: string,
): Promise<Map<string, Set<string>>> {
  const entries = await Promise.all(
    COVERAGE_FORM_KEYS.map(async (key) => {
      const form = manifest.forms[key];
      return [form.formId, await designPermissions(actorId, form)] as const;
    }),
  );
  return new Map(entries);
}

const NO_DESIGN_ACCESS: Record<DesignCheck, boolean> = {
  designListed: false,
  designRead: false,
  designUpdate: false,
  submissionsRead: false,
  staffTemplates: false,
  printUpload: false,
};

const designAnswers = (
  permissions: ReadonlySet<string>,
  listed: boolean,
): Record<DesignCheck, boolean> => {
  const grants = (...codes: PermissionCode[]) => hasAllPermissions(permissions, codes);
  return {
    designListed: listed,
    designRead: grants(Permissions.form_read),
    designUpdate: grants(Permissions.design_update),
    submissionsRead: grants(Permissions.submission_read),
    staffTemplates: grants(Permissions.form_read, Permissions.document_template_read),
    printUpload: grants(...PrintUploadPermissions),
  };
};

async function checkDesign(
  manifest: CoverageManifest,
  caller: Caller,
): Promise<CaseCheck<CoverageFormKey, DesignCheck>> {
  const resultOf = (key: CoverageFormKey, actual: Record<DesignCheck, boolean>) => ({
    persona: caller.persona,
    caseKey: key,
    actual,
    expected: expectedOf(DESIGN_CHECKS, DESIGN_EXPECTATIONS[key], caller.persona),
  });
  const actorId = signedInActorId(caller);
  // The design routes need a signed-in caller, so the public user never reaches them.
  if (!actorId) {
    return {
      results: COVERAGE_FORM_KEYS.map((key) => resultOf(key, NO_DESIGN_ACCESS)),
      issues: [],
    };
  }
  const [permissions, listed] = await Promise.all([
    coverageFormPermissions(manifest, actorId),
    coverageDesignList(manifest, actorId),
  ]);
  const issues = await Promise.all(
    COVERAGE_WORKSPACE_KEYS.map((key) =>
      designListInconsistencies(manifest, caller.persona, actorId, key, permissions),
    ),
  );
  const results = COVERAGE_FORM_KEYS.map((key) => {
    const { formId } = manifest.forms[key];
    return resultOf(key, designAnswers(permissions.get(formId) ?? new Set(), listed.has(formId)));
  });
  return { results, issues: issues.flat() };
}

const NO_WORKSPACE_ACCESS: Record<WorkspaceCheck, boolean> = {
  peopleRead: false,
  formCreate: false,
};

/** The workspaces the Create Form picker offers the actor. */
async function formCreateWorkspaceIds(actorId: string): Promise<Set<string>> {
  const rows = await lookupWorkspacesForUser({
    userId: actorId,
    requiredPermissions: FormCreatePermissions,
    limit: MAX_ROWS,
    locale: DEFAULT_SORT_LOCALE,
  });
  return new Set(rows.map((row) => row.id));
}

/** The role check the members and groups reads use, and whether the picker offers the workspace. */
async function workspaceAnswers(
  actorId: string,
  workspaceId: string,
  pickable: Set<string>,
): Promise<Record<WorkspaceCheck, boolean>> {
  const role = (await findActorMembership(workspaceId, actorId))?.role ?? null;
  return { peopleRead: isWorkspacePeopleReadRole(role), formCreate: pickable.has(workspaceId) };
}

/** The picker must offer a workspace exactly when the create check passes there. */
async function formCreateInconsistency(
  persona: PersonaKey,
  actorId: string,
  workspaceKey: CoverageWorkspaceKey,
  workspaceId: string,
  pickable: Set<string>,
): Promise<string[]> {
  const permissions = await resolveWorkspacePermissions(actorId, workspaceId);
  return hasAllPermissions(permissions, FormCreatePermissions) === pickable.has(workspaceId)
    ? []
    : [`${persona} x ${workspaceKey}: the Create Form picker differs from the create check`];
}

async function checkWorkspaces(
  manifest: CoverageManifest,
  caller: Caller,
): Promise<CaseCheck<CoverageWorkspaceKey, WorkspaceCheck>> {
  const actorId = signedInActorId(caller);
  const pickable = actorId ? await formCreateWorkspaceIds(actorId) : new Set<string>();
  const checked = await Promise.all(
    COVERAGE_WORKSPACE_KEYS.map(async (key) => {
      const workspaceId = manifest.workspaces[key].id;
      return {
        result: {
          persona: caller.persona,
          caseKey: key,
          actual: actorId
            ? await workspaceAnswers(actorId, workspaceId, pickable)
            : NO_WORKSPACE_ACCESS,
          expected: expectedOf(WORKSPACE_CHECKS, WORKSPACE_EXPECTATIONS[key], caller.persona),
        },
        issues: actorId
          ? await formCreateInconsistency(caller.persona, actorId, key, workspaceId, pickable)
          : [],
      };
    }),
  );
  return { results: checked.map((c) => c.result), issues: checked.flatMap((c) => c.issues) };
}

/** A My Submissions row's own Delete must match what the delete route allows. */
const rowDeleteIssue = (
  caller: Caller,
  key: CoverageSubmissionKey,
  row: SubmissionAccessFacts | undefined,
  answers: Record<SubmissionCheck, boolean>,
): string[] =>
  row && canDeleteOwnSubmission(row, caller.identity) !== answers.delete
    ? [`${caller.persona} x ${key}: My Submissions row Delete differs from the delete rule`]
    : [];

/**
 * A My Submissions row is decided from the facts read with it: its form must be the form My Forms
 * lists, and Continue must match a write the routes allow on a submission still in progress.
 */
function rowFactsIssues(
  caller: Caller,
  key: CoverageSubmissionKey,
  row: ParticipantSubmissionListRow | undefined,
  mine: MySubmissions,
  myForms: Map<string, SubmitterFormListRow>,
  answers: Record<SubmissionCheck, boolean>,
): string[] {
  if (!row) return [];
  const prefix = `${caller.persona} x ${key}`;
  const form = mine.forms.get(row.formId);
  if (!form) return [`${prefix}: My Submissions row has no form read with it`];
  const issues: string[] = [];
  if (!isDeepStrictEqual(form, myForms.get(row.formId))) {
    issues.push(`${prefix}: My Submissions row's form differs from the My Forms row`);
  }
  const canContinue = canContinueSubmission(row, form, { idpCode: caller.identity.idpCode });
  if (canContinue !== (answers.write && isSubmissionEditable(row.workflowState))) {
    issues.push(`${prefix}: My Submissions row Continue differs from the write rule`);
  }
  return issues;
}

const roleOf = (owner: boolean, participant: boolean): string | null => {
  if (owner) return SubmissionParticipantRole.owner;
  return participant ? SubmissionParticipantRole.collaborator : null;
};

/**
 * The routes decide from one read of the submission. It must hold the role the participant read
 * gives and the form My Forms lists, and find the same submissions live.
 */
async function submissionReadIssues(
  caller: Caller,
  key: CoverageSubmissionKey,
  ref: CoverageSubmissionRef,
): Promise<string[]> {
  const { actorId, idpCode } = caller.identity;
  if (!actorId) return [];
  const prefix = `${caller.persona} x ${key}`;
  const [read, live] = await Promise.all([
    findSubmitterSubmission({ submissionId: ref.submissionId, actorId, idpCode }),
    getSubmissionWorkspaceAndState(ref.submissionId),
  ]);
  if (!read || !live) {
    return Boolean(read) === Boolean(live)
      ? []
      : [`${prefix}: the one read and the liveness read disagree`];
  }
  const [owner, participant, form, detail] = await Promise.all([
    isActiveOwner(ref.submissionId, actorId),
    isActiveParticipant(ref.submissionId, actorId),
    listSubmitterForms({
      userId: idpCode === PUBLIC_PROVIDER_CODE ? null : actorId,
      formIds: [live.formId],
    }).then((rows) => rows[0]),
    getSubmissionById(live.workspaceId, ref.submissionId),
  ]);
  const issues: string[] = [];
  if (read.access.role !== roleOf(owner, participant)) {
    issues.push(`${prefix}: the one read's role differs from the participant read`);
  }
  if (!isDeepStrictEqual(read.form, form)) {
    issues.push(`${prefix}: the one read's form differs from the My Forms row`);
  }
  if (!detail || !isDeepStrictEqual(toSubmissionDto(read.submission), toSubmissionDto(detail))) {
    issues.push(`${prefix}: the one read's submission differs from the detail read`);
  }
  return issues;
}

async function checkSubmissions(
  manifest: CoverageManifest,
  caller: Caller,
): Promise<CaseCheck<CoverageSubmissionKey, SubmissionCheck>> {
  const [mine, myForms] = await Promise.all([mySubmissionRows(caller), allMyFormRows(caller)]);
  const checked = await Promise.all(
    COVERAGE_SUBMISSION_KEYS.map(async (key) => {
      const ref = manifest.submissions[key];
      const answers = await submissionAnswers(caller, ref, mine.rows);
      return {
        result: {
          persona: caller.persona,
          caseKey: key,
          actual: answers,
          expected: expectedOf(SUBMISSION_CHECKS, SUBMISSION_EXPECTATIONS[key], caller.persona),
        },
        issues: [
          ...rowDeleteIssue(caller, key, mine.rows.get(ref.submissionId), answers),
          ...rowFactsIssues(caller, key, mine.rows.get(ref.submissionId), mine, myForms, answers),
          ...(await submissionReadIssues(caller, key, ref)),
        ],
      };
    }),
  );
  return { results: checked.map((c) => c.result), issues: checked.flatMap((c) => c.issues) };
}

const skipsOwner = (manifest: CoverageManifest): boolean =>
  manifest.personas[OWNER].identityProviderCode !== OWNER_PROVIDER;

/**
 * Every persona against every form, workspace and submission in the coverage set. Personas run in
 * turn and each persona's cases together, which bounds how many queries wait for a pooled
 * connection.
 */
export async function checkCoverage(manifest: CoverageManifest): Promise<CoverageReport> {
  const ownerProvider = manifest.personas[OWNER].identityProviderCode;
  const personas = PERSONA_KEYS.filter((persona) => persona !== OWNER || !skipsOwner(manifest));
  const [shown, lookups, signIns] = await Promise.all([
    deletedRowsShown(manifest),
    lookupInconsistencies(manifest),
    signInInconsistencies(manifest),
  ]);
  const checked = await mapInOrder(personas, async (persona) => {
    const caller = callerOf(manifest, persona);
    const [forms, design, workspaces, submissions] = await Promise.all([
      checkForms(manifest, caller),
      checkDesign(manifest, caller),
      checkWorkspaces(manifest, caller),
      checkSubmissions(manifest, caller),
    ]);
    return { forms, design, workspaces, submissions };
  });
  return {
    personas,
    skipped: skipsOwner(manifest)
      ? [`${OWNER}: signs in through ${ownerProvider}, the table assumes ${OWNER_PROVIDER}`]
      : [],
    forms: checked.flatMap((c) => c.forms.results),
    design: checked.flatMap((c) => c.design.results),
    workspaces: checked.flatMap((c) => c.workspaces.results),
    submissions: checked.flatMap((c) => c.submissions.results),
    inconsistencies: [
      ...shown,
      ...lookups,
      ...signIns,
      ...checked.flatMap((c) => [
        ...c.forms.issues,
        ...c.design.issues,
        ...c.workspaces.issues,
        ...c.submissions.issues,
      ]),
    ],
  };
}

const formNameOf = (manifest: CoverageManifest, formId: string): string =>
  Object.values(manifest.forms).find((form) => form.formId === formId)?.name ?? formId;

export type ExplainLine = [label: string, value: string];

const yesNo = (value: boolean): string => (value ? 'yes' : 'no');

const answerLines = <TCheck extends string>(
  actual: Record<TCheck, boolean>,
  expected: Record<TCheck, boolean>,
): ExplainLine[] =>
  (Object.keys(actual) as TCheck[]).map((check) => [
    check,
    actual[check] === expected[check]
      ? yesNo(actual[check])
      : `${yesNo(actual[check])}, expected ${yesNo(expected[check])}`,
  ]);

/** The facts one form's rules read for one persona, and each answer. */
export async function explainForm(
  manifest: CoverageManifest,
  persona: PersonaKey,
  formKey: CoverageFormKey,
): Promise<ExplainLine[]> {
  const caller = callerOf(manifest, persona);
  const actorId = signedInActorId(caller);
  const form = manifest.forms[formKey];
  const facts = await findSubmitterFormFacts({
    userId: actorId,
    workspaceId: form.workspaceId,
    formId: form.formId,
  });
  const published = await getPublishedVersionForForm(form.workspaceId, form.formId);
  const rows = await myFormRows(caller, form.workspaceId);
  const answers = { listed: rows.has(form.formId), ...(await formAnswers(caller, form)) };
  const design = actorId
    ? designAnswers(
        await designPermissions(actorId, form),
        (await coverageDesignList(manifest, actorId)).has(form.formId),
      )
    : NO_DESIGN_ACCESS;
  const idp = { idpCode: caller.identity.idpCode };

  return [
    ['persona', `${persona} (${caller.identity.idpCode}) ${caller.identity.actorId}`],
    ['form', `${form.name} ${form.formId}`],
    ['form live', yesNo((await getWorkspaceIdForForm(form.formId)) !== null)],
    ['published version', published?.id ?? 'none'],
    ['permissions', facts?.permissions.join(', ') || 'none'],
    ['audience', facts ? `${facts.audienceMode} [${facts.audienceIdps.join(', ')}]` : 'none'],
    ['drafts', facts ? draftSaveStatusOf(facts) : 'none'],
    [
      'roles grant open',
      yesNo(
        caller.identity.idpCode !== PUBLIC_PROVIDER_CODE &&
          hasAllPermissions(facts?.permissions ?? [], [Permissions.submission_create]),
      ),
    ],
    ['audience admits', yesNo(!!facts && audienceAdmits(facts, idp))],
    ...answerLines(answers, expectedOf(FORM_CHECKS, FORM_EXPECTATIONS[formKey], persona)),
    ...answerLines(design, expectedOf(DESIGN_CHECKS, DESIGN_EXPECTATIONS[formKey], persona)),
  ];
}

/** One persona's grants on one submission, and each answer. */
export async function explainSubmission(
  manifest: CoverageManifest,
  persona: PersonaKey,
  key: CoverageSubmissionKey,
): Promise<ExplainLine[]> {
  const caller = callerOf(manifest, persona);
  const ref = manifest.submissions[key];
  const live = await getSubmissionWorkspaceAndState(ref.submissionId);
  const grants = caller.identity.actorId
    ? await db
        .select({ role: submissionParticipants.role, status: submissionParticipants.status })
        .from(submissionParticipants)
        .where(
          and(
            eq(submissionParticipants.submissionId, ref.submissionId),
            eq(submissionParticipants.userId, caller.identity.actorId),
          ),
        )
    : [];
  const answers = await submissionAnswers(caller, ref, (await mySubmissionRows(caller)).rows);

  return [
    ['persona', `${persona} (${caller.identity.idpCode}) ${caller.identity.actorId}`],
    ['submission', ref.submissionId],
    ['form', formNameOf(manifest, ref.formId)],
    ['state', live?.workflowState ?? 'deleted'],
    ['grants', grants.map((g) => `${g.role} ${g.status}`).join(', ') || 'none'],
    [
      'open rule on the form',
      yesNo(await hasFormSubmitAccess(ref, caller.identity, Permissions.submission_create)),
    ],
    ...answerLines(answers, expectedOf(SUBMISSION_CHECKS, SUBMISSION_EXPECTATIONS[key], persona)),
  ];
}
