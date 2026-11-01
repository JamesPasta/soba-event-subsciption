import {
  DOCGEN_AUDIT_SORT_FIELDS,
  CREDENTIAL_SORT_FIELDS,
  FEATURE_SCOPE_SORT_FIELDS,
  FORM_SORT_FIELDS,
  FORM_VERSION_SORT_FIELDS,
  JOB_SORT_FIELDS,
  MY_FORM_SORT_FIELDS,
  SOBA_ADMIN_SORT_FIELDS,
  SUBMISSION_EXPORT_SORT_FIELDS,
  SUBMISSION_SORT_FIELDS,
  WORKSPACE_ACCESS_SORT_FIELDS,
  WORKSPACE_GROUP_SORT_FIELDS,
  WORKSPACE_SORT_FIELDS,
  sortTokensFor,
} from '@soba/lib/sort';
import {
  readSessionValue,
  removeSessionValues,
  writeSessionValue,
} from '@/src/shared/storage/sessionStore';

/**
 * A list's URL params: the filters it owns plus the paging set every list carries. They are
 * remembered and restored as one set, so a list that gains a filter only has to declare it here.
 */
export type ListQuerySpec = {
  resource: string;
  filters: readonly string[];
  /** Sort tokens the endpoint accepts. Anything else in the URL falls back to the default. */
  sortOptions: readonly string[];
  defaultSort: string;
  /**
   * The record the list belongs to, such as a form, so each one remembers its own query. It changes
   * only the remembered key, not the URL names.
   */
  memoryScope?: string;
};

export type ListQueryParams = Record<string, string>;

/** Paging, search and sort, resolved by the server on every list. */
export const SHARED_LIST_PARAMS = ['q', 'sort', 'page', 'pageSize'] as const;

export const listQueryParams = (spec: ListQuerySpec): string[] => [
  ...spec.filters,
  ...SHARED_LIST_PARAMS,
];

/**
 * The URL name for one of a list's params. Namespaced by resource, because two lists can share a
 * route: the designer holds version history and submissions at once, and a bare `page` would have
 * each of them answering for the other's table.
 */
export const urlParamName = (spec: ListQuerySpec, name: string): string =>
  `${spec.resource}.${name}`;

const UPDATED_DESC = 'updatedAt:desc';
const CREATED_DESC = 'createdAt:desc';

export const FORMS_LIST_QUERY: ListQuerySpec = {
  resource: 'forms',
  filters: ['workspace'],
  sortOptions: sortTokensFor(FORM_SORT_FIELDS),
  defaultSort: CREATED_DESC,
};

export const WORKSPACES_LIST_QUERY: ListQuerySpec = {
  resource: 'workspaces',
  filters: [],
  sortOptions: sortTokensFor(WORKSPACE_SORT_FIELDS),
  defaultSort: 'name:asc',
};

/** The submissions tab inside the designer. Same shape, its own remembered query. */
export const FORM_SUBMISSIONS_LIST_QUERY: ListQuerySpec = {
  resource: 'formSubmissions',
  filters: [],
  sortOptions: sortTokensFor(SUBMISSION_SORT_FIELDS),
  // A column carries this one, so the header can report the order and reverse it.
  defaultSort: 'submittedAt:desc',
};

/** The caller's own submissions in submit mode. */
export const MY_SUBMISSIONS_LIST_QUERY: ListQuerySpec = {
  resource: 'mySubmissions',
  filters: ['state'],
  sortOptions: sortTokensFor(SUBMISSION_SORT_FIELDS),
  defaultSort: UPDATED_DESC,
};

/** The forms the caller holds the submitter role on or has submitted to, in submit mode. */
export const MY_FORMS_LIST_QUERY: ListQuerySpec = {
  resource: 'myForms',
  filters: ['workspace'],
  sortOptions: sortTokensFor(MY_FORM_SORT_FIELDS),
  defaultSort: 'name:asc',
};

/** The version history tab inside the designer. */
export const FORM_VERSIONS_LIST_QUERY: ListQuerySpec = {
  resource: 'formVersions',
  filters: [],
  sortOptions: sortTokensFor(FORM_VERSION_SORT_FIELDS),
  defaultSort: 'versionNo:desc',
};

/** The access tab inside the designer. Its columns do not sort. */
export const FORM_TEAM_LIST_QUERY: ListQuerySpec = {
  resource: 'formTeam',
  filters: [],
  sortOptions: ['name:asc'],
  defaultSort: 'name:asc',
};

export const SOBA_ADMINS_LIST_QUERY: ListQuerySpec = {
  resource: 'sobaAdmins',
  filters: [],
  sortOptions: sortTokensFor(SOBA_ADMIN_SORT_FIELDS),
  defaultSort: 'displayLabel:asc',
};

export const FEATURE_SCOPES_LIST_QUERY: ListQuerySpec = {
  resource: 'featureScopes',
  filters: [],
  sortOptions: sortTokensFor(FEATURE_SCOPE_SORT_FIELDS),
  defaultSort: UPDATED_DESC,
};

export const DOCGEN_AUDITS_LIST_QUERY: ListQuerySpec = {
  resource: 'docgenAudits',
  filters: [],
  sortOptions: sortTokensFor(DOCGEN_AUDIT_SORT_FIELDS),
  defaultSort: CREATED_DESC,
};

export const JOBS_LIST_QUERY: ListQuerySpec = {
  resource: 'jobs',
  filters: ['status', 'type', 'workspaceId', 'formId', 'submissionId'],
  sortOptions: sortTokensFor(JOB_SORT_FIELDS),
  defaultSort: CREATED_DESC,
};

/** A form's jobs, in the designer. Scope it to the form with `scopedListQuery`. */
export const FORM_JOBS_LIST_QUERY: ListQuerySpec = {
  resource: 'formJobs',
  filters: ['status', 'type'],
  sortOptions: sortTokensFor(JOB_SORT_FIELDS),
  defaultSort: CREATED_DESC,
};

/** A workspace's jobs, on the workspace page. Scope it to the workspace with `scopedListQuery`. */
export const WORKSPACE_JOBS_LIST_QUERY: ListQuerySpec = {
  resource: 'workspaceJobs',
  filters: ['status', 'type', 'formId'],
  sortOptions: sortTokensFor(JOB_SORT_FIELDS),
  defaultSort: CREATED_DESC,
};

/** The reader's exports of a form. Scope it to the form with `scopedListQuery`. */
export const SUBMISSION_EXPORTS_LIST_QUERY: ListQuerySpec = {
  resource: 'submissionExports',
  filters: [],
  sortOptions: sortTokensFor(SUBMISSION_EXPORT_SORT_FIELDS),
  defaultSort: CREATED_DESC,
};

/** A workspace's or form's API keys. Scope it to the owner with `scopedListQuery`. */
export const CREDENTIALS_LIST_QUERY: ListQuerySpec = {
  resource: 'credentials',
  filters: [],
  sortOptions: sortTokensFor(CREDENTIAL_SORT_FIELDS),
  defaultSort: CREATED_DESC,
};

export const scopedListQuery = (spec: ListQuerySpec, memoryScope: string): ListQuerySpec => ({
  ...spec,
  memoryScope,
});

export const WORKSPACE_GROUPS_LIST_QUERY: ListQuerySpec = {
  resource: 'workspaceGroups',
  filters: [],
  sortOptions: sortTokensFor(WORKSPACE_GROUP_SORT_FIELDS),
  defaultSort: 'name:asc',
};

export const WORKSPACE_ACCESS_LIST_QUERY: ListQuerySpec = {
  resource: 'workspaceAccess',
  filters: ['include'],
  sortOptions: sortTokensFor(WORKSPACE_ACCESS_SORT_FIELDS),
  defaultSort: 'displayLabel:asc',
};

const KEY_PREFIX = 'soba.listQuery.';
const keyFor = (spec: ListQuerySpec) =>
  [`${KEY_PREFIX}${spec.resource}`, spec.memoryScope].filter(Boolean).join('.');

/**
 * Marks a link inside the app, whose destination is "the list as I left it". A bare URL is someone
 * else's link or a bookmark and means the unfiltered list, so the two have to be distinguishable.
 * Stripped from the URL on arrival.
 */
export const NAV_MARKER = 'from';
const NAV_MARKER_VALUE = 'nav';

export const navLink = (href: string) =>
  `${href}${href.includes('?') ? '&' : '?'}${NAV_MARKER}=${NAV_MARKER_VALUE}`;

/**
 * A link to a list with its query already set. The names come from the spec, so a caller cannot
 * hand-write one the list will not read back.
 */
export function listLink(href: string, spec: ListQuerySpec, params: ListQueryParams): string {
  const search = new URLSearchParams();
  for (const name of listQueryParams(spec)) {
    if (params[name]) search.set(urlParamName(spec, name), params[name]);
  }
  const query = search.toString();
  return query ? `${href}?${query}` : href;
}

export function isNavArrival(search: URLSearchParams): boolean {
  return search.get(NAV_MARKER) === NAV_MARKER_VALUE;
}

/** This list's params as the URL currently carries them, under their own names. */
export function readUrlParams(spec: ListQuerySpec, search: URLSearchParams): ListQueryParams {
  const params: ListQueryParams = {};
  for (const name of listQueryParams(spec)) {
    const value = search.get(urlParamName(spec, name));
    if (value) params[name] = value;
  }
  return params;
}

export function urlHasListParams(spec: ListQuerySpec, search: URLSearchParams): boolean {
  return listQueryParams(spec).some((name) => search.has(urlParamName(spec, name)));
}

export function rememberListQuery(spec: ListQuerySpec, params: ListQueryParams): void {
  writeSessionValue(keyFor(spec), params);
}

/**
 * `null` when this tab has never answered for the list, which is not the same as a remembered
 * empty query: clearing a filter is a choice and must not be overridden by the last one before it.
 */
export function recallListQuery(spec: ListQuerySpec): ListQueryParams | null {
  return readSessionValue<ListQueryParams>(keyFor(spec));
}

export function forgetListQueries(): void {
  removeSessionValues((key) => key.startsWith(KEY_PREFIX));
}
