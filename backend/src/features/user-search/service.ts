import {
  USER_SEARCH_FIELDS,
  type CreateUserFromSearchBody,
  type CreateUserFromSearchResponse,
  type SortLocale,
  type UserSearchCapabilitiesResponse,
  type UserSearchField,
  type UserSearchPluginOutcome,
  type UserSearchPluginStatus,
  type UserSearchQuery,
  type UserSearchResponse,
} from '@soba/lib';
import { ServiceUnavailableError, ValidationError } from '../../core/errors';
import { log } from '../../core/logging';
import { listLoginIdentityProviders } from '../../core/db/repos/identityProviderRepo';
import { findIdentityOwners } from '../../core/db/repos/identityLookup';
import { findOrCreateUserFromDirectory } from '../../core/db/repos/membershipRepo';
import {
  createUserSearchAdapter,
  getEnabledUserSearchPluginCodes,
} from '../../core/integrations/user-search/UserSearchRegistry';
import type {
  UserSearchCapability,
  UserSearchAdapter,
} from '../../core/integrations/user-search/UserSearchAdapter';
import {
  displayNameOf,
  identityKey,
  mergeHits,
  orderUsers,
  type MergedHit,
  type PluginHits,
} from './merge';
import { confirmedPerson, hasGuid, profileFromHit, signInSubjectOf } from './directoryUser';

/** Most hits taken from one plugin for one identity provider. */
export const PLUGIN_LIMIT = 25;
/** Most people one search returns. */
export const RESULT_LIMIT = 50;

/** Narrows search on one surface. Unset allows every active login provider. */
export interface UserSearchPolicy {
  identityProviders?: readonly string[];
}

interface LoadedPlugin {
  code: string;
  adapter: UserSearchAdapter;
  capabilities: readonly UserSearchCapability[];
}

interface LoadedPlugins {
  loaded: LoadedPlugin[];
  /** Enabled codes that could not be built or could not report capabilities. */
  failed: string[];
}

const SEARCH_UNAVAILABLE = 'User search is unavailable';

const errorName = (err: unknown): string => (err instanceof Error ? err.name : 'UnknownError');

async function loadPlugins(): Promise<LoadedPlugins> {
  const codes = getEnabledUserSearchPluginCodes();
  const outcomes = await Promise.allSettled(
    codes.map(async (code) => {
      const adapter = createUserSearchAdapter(code);
      return { code, adapter, capabilities: await adapter.capabilities() };
    }),
  );
  const result: LoadedPlugins = { loaded: [], failed: [] };
  outcomes.forEach((outcome, index) => {
    if (outcome.status === 'fulfilled') {
      result.loaded.push(outcome.value);
      return;
    }
    log.warn(
      { plugin: codes[index], failureType: errorName(outcome.reason) },
      'User search plugin could not load',
    );
    result.failed.push(codes[index]);
  });
  return result;
}

const accepts = (
  capabilities: readonly UserSearchCapability[],
  identityProvider: string,
  fields: readonly UserSearchField[],
): boolean =>
  capabilities.some(
    (capability) =>
      capability.identityProvider === identityProvider &&
      fields.every((field) => capability.fields.includes(field)),
  );

/** Active login providers the policy allows, by name. */
async function allowedIdentityProviders(policy: UserSearchPolicy, locale: SortLocale) {
  const identityProviders = await listLoginIdentityProviders(locale);
  const allowed = policy.identityProviders;
  return allowed
    ? identityProviders.filter(({ code }) => allowed.includes(code))
    : identityProviders;
}

/** The identity providers searchable here, each with the filters some enabled plugin accepts. */
export async function getUserSearchCapabilities(
  policy: UserSearchPolicy,
  locale: SortLocale,
): Promise<UserSearchCapabilitiesResponse> {
  const [identityProviders, { loaded }] = await Promise.all([
    allowedIdentityProviders(policy, locale),
    loadPlugins(),
  ]);
  return {
    identityProviders: identityProviders.flatMap(({ code, name }) => {
      const fields = USER_SEARCH_FIELDS.filter((field) =>
        loaded.some(({ capabilities }) => accepts(capabilities, code, [field])),
      );
      return fields.length > 0 ? [{ code, name, fields }] : [];
    }),
  };
}

const filtersOf = (query: UserSearchQuery): Partial<Record<UserSearchField, string>> =>
  Object.fromEntries(
    USER_SEARCH_FIELDS.flatMap((field) => (query[field] ? [[field, query[field]]] : [])),
  );

/** One plugin searching one identity provider. */
interface PlannedSearch {
  plugin: LoadedPlugin;
  identityProvider: string;
}

interface SearchAnswer {
  outcome: UserSearchPluginOutcome;
  truncated: boolean;
}

function failedOutcome(
  { plugin, identityProvider }: PlannedSearch,
  reason: unknown,
): UserSearchPluginOutcome {
  if (reason instanceof ValidationError) return 'rejected';
  if (!(reason instanceof ServiceUnavailableError)) {
    log.warn(
      { plugin: plugin.code, identityProvider, failureType: errorName(reason) },
      'User search plugin failed',
    );
  }
  return 'unavailable';
}

/** Unavailable if any of the plugin's searches could not answer, rejected if all refused. */
function pluginStatus(code: string, answers: readonly SearchAnswer[]): UserSearchPluginStatus {
  let status: UserSearchPluginOutcome = 'ok';
  if (answers.some(({ outcome }) => outcome === 'unavailable')) status = 'unavailable';
  else if (answers.every(({ outcome }) => outcome === 'rejected')) status = 'rejected';
  return { code, status, truncated: answers.some(({ truncated }) => truncated) };
}

/** Hits keep plugin order, so an earlier plugin's values win when merged. */
async function runSearches(
  searches: readonly PlannedSearch[],
  filters: Partial<Record<UserSearchField, string>>,
): Promise<{ plugins: UserSearchPluginStatus[]; results: PluginHits[] }> {
  const settled = await Promise.allSettled(
    searches.map(async ({ plugin, identityProvider }) =>
      plugin.adapter.search({ identityProvider, filters, limit: PLUGIN_LIMIT }),
    ),
  );
  const answers = new Map<string, SearchAnswer[]>();
  const results: PluginHits[] = [];
  settled.forEach((outcome, index) => {
    const search = searches[index];
    const { code } = search.plugin;
    const pluginAnswers = answers.get(code) ?? [];
    answers.set(code, pluginAnswers);
    if (outcome.status === 'rejected') {
      pluginAnswers.push({ outcome: failedOutcome(search, outcome.reason), truncated: false });
      return;
    }
    pluginAnswers.push({ outcome: 'ok', truncated: outcome.value.truncated });
    results.push({ code, hits: outcome.value.hits });
  });
  return {
    plugins: [...answers].map(([code, pluginAnswers]) => pluginStatus(code, pluginAnswers)),
    results,
  };
}

/**
 * Ask every enabled plugin that accepts these filters, for each of the identity providers, and
 * merge the people they find.
 * - 400: no plugin accepts the filters, or every plugin asked refused them.
 * - 503: no plugin is enabled, none asked could answer, or no plugin accepts the filters while
 *   one could not be built.
 */
async function findPeople(
  identityProviders: readonly string[],
  filters: Partial<Record<UserSearchField, string>>,
): Promise<{ people: MergedHit[]; plugins: UserSearchPluginStatus[] }> {
  const fields = Object.keys(filters) as UserSearchField[];
  const { loaded, failed } = await loadPlugins();
  const searches = loaded.flatMap((plugin) =>
    identityProviders
      .filter((identityProvider) => accepts(plugin.capabilities, identityProvider, fields))
      .map((identityProvider) => ({ plugin, identityProvider })),
  );
  if (searches.length === 0) {
    // Unavailable rather than invalid when no plugin loaded or one failed to load.
    if (loaded.length === 0 || failed.length > 0) {
      throw new ServiceUnavailableError(SEARCH_UNAVAILABLE);
    }
    throw new ValidationError('No user search plugin accepts these filters');
  }

  const { plugins, results } = await runSearches(searches, filters);
  for (const code of failed) plugins.push({ code, status: 'unavailable', truncated: false });
  if (results.length === 0) {
    if (plugins.some(({ status }) => status === 'unavailable')) {
      throw new ServiceUnavailableError(SEARCH_UNAVAILABLE);
    }
    throw new ValidationError('Every user search plugin refused the search');
  }
  return { people: mergeHits(results), plugins };
}

/**
 * Search for the identity provider asked or else every one searchable here.
 * - 400: the identity provider asked is not searchable here, or as for findPeople.
 * - 503: as for findPeople.
 */
export async function searchUsers(
  query: UserSearchQuery,
  policy: UserSearchPolicy,
  locale: SortLocale,
): Promise<UserSearchResponse> {
  const allowed = (await allowedIdentityProviders(policy, locale)).map(({ code }) => code);
  const asked = query.identityProvider;
  if (asked && !allowed.includes(asked)) {
    throw new ValidationError(`${asked} users cannot be searched here`);
  }
  const { people, plugins } = await findPeople(asked ? [asked] : allowed, filtersOf(query));
  const owners = await findIdentityOwners(people);
  const userIds = new Map(
    owners.map((owner) => [identityKey(owner.identityProvider, owner.subject), owner.userId]),
  );
  const users = orderUsers(
    people.map((person) => ({
      ...person,
      displayName: displayNameOf(person),
      sobaUserId: userIds.get(identityKey(person.identityProvider, person.subject)) ?? null,
    })),
    locale,
  );
  return {
    users: users.slice(0, RESULT_LIMIT),
    truncated: users.length > RESULT_LIMIT || plugins.some(({ truncated }) => truncated),
    plugins,
  };
}

/**
 * The Soba user for a person user search finds, made from the directory's details when they have
 * never signed in. The directory is asked again by guid; nothing else the caller sends is kept. A
 * new user has no access until something grants it.
 * - 400: the identity provider cannot be searched here, or as for findPeople.
 * - 404 person_not_found: the directory has no one with that guid.
 * - 422 identity_unconfirmed: the directory's identifier is not the one sign-in will send.
 * - 503: as for findPeople.
 */
export async function createUserFromSearch(
  body: CreateUserFromSearchBody,
  policy: UserSearchPolicy,
  locale: SortLocale,
  actor: { actorId: string; actorDisplayLabel: string | null },
): Promise<CreateUserFromSearchResponse> {
  const { identityProvider, guid } = body;
  const allowed = await allowedIdentityProviders(policy, locale);
  if (!allowed.some(({ code }) => code === identityProvider)) {
    throw new ValidationError(`${identityProvider} users cannot be added here`);
  }
  const { people, plugins } = await findPeople([identityProvider], { guid });
  // Not found is only an answer when every plugin asked could answer.
  const matched = people.some((person) => hasGuid(person, identityProvider, guid));
  if (!matched && plugins.some(({ status }) => status === 'unavailable')) {
    throw new ServiceUnavailableError(SEARCH_UNAVAILABLE);
  }
  const person: MergedHit = confirmedPerson(people, identityProvider, guid);
  const result = await findOrCreateUserFromDirectory({
    providerCode: identityProvider,
    subject: signInSubjectOf(identityProvider, guid),
    profile: profileFromHit(person),
    actorDisplayLabel: actor.actorDisplayLabel,
  });
  if (result.created) {
    log.info(
      { actorId: actor.actorId, userId: result.userId, identityProvider, sources: person.sources },
      'User created from user search',
    );
  }
  return result;
}
