import { z } from 'zod';
import type { UserSearchField } from '@soba/lib';
import type { PluginConfigReader } from '../../core/config/pluginConfig';
import type {
  UserSearchCapability,
  UserSearchHit,
  UserSearchAdapter,
  UserSearchAdapterResult,
  UserSearchReadinessResult,
  UserSearchRequest,
} from '../../core/integrations/user-search/UserSearchAdapter';
import { OAuth2TokenProvider } from '../../core/auth/oauth2TokenProvider';
import { HttpClient, HttpClientError, resolveTimeoutMs } from '../../core/http/httpClient';
import { ServiceUnavailableError, ValidationError } from '../../core/errors';
import { log } from '../../core/logging';

const PLUGIN = 'css-v1';

const IDIR_FIELDS: readonly UserSearchField[] = ['email', 'firstName', 'lastName', 'guid'];

// Soba identity provider code to the CSS lookup path and the filters CSS accepts on it.
const LOOKUPS: Readonly<Record<string, { path: string; fields: readonly UserSearchField[] }>> = {
  idir: { path: 'idir', fields: IDIR_FIELDS },
  azureidir: { path: 'azure-idir', fields: IDIR_FIELDS },
  // CSS looks BCeID users up by guid only.
  bceidbusiness: { path: 'business-bceid', fields: ['guid'] },
};

const CssUserSchema = z.object({
  username: z.string().min(1),
  email: z.string().nullish(),
  firstName: z.string().nullish(),
  lastName: z.string().nullish(),
  attributes: z.record(z.string(), z.unknown()).nullish(),
});
type CssUser = z.infer<typeof CssUserSchema>;

const CssUsersResponseSchema = z.object({ data: z.array(CssUserSchema) });

const isTokenRejected = (err: unknown): boolean =>
  err instanceof HttpClientError && err.status === 401;

// CSS refuses a filter it cannot use with 400 or 422.
const isFilterRejected = (err: unknown): boolean =>
  err instanceof HttpClientError && (err.status === 400 || err.status === 422);

const text = (value: string | null | undefined): string | null => (value?.trim() ? value : null);

/** CSS attributes are string arrays; the first entry is the value. */
const attribute = (attributes: CssUser['attributes'], key: string): string | null => {
  const value = attributes?.[key];
  const first: unknown = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' ? text(first) : null;
};

function toHit(identityProvider: string, user: CssUser): UserSearchHit {
  const { attributes } = user;
  return {
    identityProvider,
    subject: user.username,
    guid: attribute(attributes, 'idir_user_guid') ?? attribute(attributes, 'bceid_user_guid'),
    username: attribute(attributes, 'idir_username') ?? attribute(attributes, 'bceid_username'),
    displayName: attribute(attributes, 'display_name'),
    firstName: text(user.firstName),
    lastName: text(user.lastName),
    email: text(user.email),
  };
}

/** IDIR and BCeID Business lookups through the CSS API, as the team's CSS API account. */
export class CssUserSearchAdapter implements UserSearchAdapter {
  private readonly client: HttpClient;
  private readonly tokenProvider: OAuth2TokenProvider;
  private readonly environment: string;

  constructor(config: PluginConfigReader) {
    this.environment = z.enum(['dev', 'test', 'prod']).parse(config.getRequired('ENVIRONMENT'));
    const timeoutMs = resolveTimeoutMs(
      config.getOptionalNumber('TIMEOUT_MS'),
      'PLUGIN_CSS_V1_TIMEOUT_MS',
    );
    this.tokenProvider = new OAuth2TokenProvider({
      tokenUrl: config.getRequired('TOKEN_URL'),
      clientId: config.getRequired('CLIENT_ID'),
      clientSecret: config.getRequired('CLIENT_SECRET'),
      label: PLUGIN,
      timeoutMs,
    });
    this.client = new HttpClient({
      baseUrl: config.getRequired('API_BASE_URL'),
      timeoutMs,
      getToken: (remaining) => this.tokenProvider.getToken(remaining),
    });
  }

  capabilities(): Promise<readonly UserSearchCapability[]> {
    return Promise.resolve(
      Object.entries(LOOKUPS).map(([identityProvider, lookup]) => ({
        identityProvider,
        fields: lookup.fields,
      })),
    );
  }

  // The token exchange proves the credentials without running a directory search.
  async readinessCheck(): Promise<UserSearchReadinessResult> {
    try {
      await this.tokenProvider.getToken();
      return { ok: true };
    } catch {
      return { ok: false, message: 'CSS credential exchange failed' };
    }
  }

  async search(request: UserSearchRequest): Promise<UserSearchAdapterResult> {
    const lookup = LOOKUPS[request.identityProvider];
    if (!lookup) throw new ValidationError(`CSS does not search ${request.identityProvider} users`);
    const params = new URLSearchParams();
    for (const field of lookup.fields) {
      const value = request.filters[field];
      if (value) params.set(field, value);
    }

    let body: unknown;
    try {
      body = await this.getJson(`${this.environment}/${lookup.path}/users?${params.toString()}`);
    } catch (err) {
      throw this.failure(err);
    }
    const parsed = CssUsersResponseSchema.safeParse(body);
    if (!parsed.success) {
      log.warn({ plugin: PLUGIN, failureType: 'UnexpectedResponse' }, 'CSS user search failed');
      throw new ServiceUnavailableError('CSS returned an unexpected response');
    }
    const users = parsed.data.data;
    return {
      hits: users.slice(0, request.limit).map((user) => toHit(request.identityProvider, user)),
      truncated: users.length > request.limit,
    };
  }

  /** GET and decode JSON, retrying once with a fresh token when CSS rejects the cached one. */
  private async getJson(path: string): Promise<unknown> {
    // One budget for the attempt and its retry.
    const deadline = this.client.deadline();
    try {
      return await this.readJson(path, deadline);
    } catch (err) {
      if (!isTokenRejected(err)) throw err;
      this.tokenProvider.clearCache();
      return this.readJson(path, deadline);
    }
  }

  private async readJson(path: string, deadline: number): Promise<unknown> {
    const response = await this.client.getForBinary(path, deadline);
    return JSON.parse(response.data.toString('utf8'));
  }

  // Credentials, search filters and directory records stay out of the log and the error.
  private failure(err: unknown): Error {
    log.warn(
      {
        plugin: PLUGIN,
        failureType: err instanceof Error ? err.name : 'UnknownError',
        upstreamStatus: err instanceof HttpClientError ? err.status : undefined,
      },
      'CSS user search failed',
    );
    return isFilterRejected(err)
      ? new ValidationError('CSS rejected the search')
      : new ServiceUnavailableError('CSS user search is unavailable');
  }
}
