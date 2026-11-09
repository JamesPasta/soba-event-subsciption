/**
 * Form.io CE v5 API client for the formio-v5 form-engine plugin.
 * Uses plugin config (PluginConfigReader), not process.env. No URL logging.
 */

import type { PluginConfigReader } from '../../core/config/pluginConfig';
import { resolveTimeoutMs } from '../../core/http/httpClient';

const TIMEOUT_LABEL = 'PLUGIN_FORMIO_V5_TIMEOUT_MS';

export class FormioApiError extends Error {
  readonly status: number;
  readonly body: string;
  readonly url: string;

  constructor(status: number, body: string, url: string) {
    super(`Formio API ${status}: ${body}`);
    this.name = 'FormioApiError';
    this.status = status;
    this.body = body;
    this.url = url;
  }
}

/** Form.io answers a read of a missing form or submission with 404, or 400 "Resource not found". */
export const isFormioNotFound = (err: unknown): boolean =>
  err instanceof FormioApiError &&
  (err.status === 404 || (err.status === 400 && /resource not found/i.test(err.body)));

export type FormioQuery =
  | { params?: Record<string, string | number | boolean | null | undefined> }
  | undefined;

function buildQueryString(query?: FormioQuery): string {
  if (!query?.params || typeof query.params !== 'object') return '';
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(query.params)) {
    if (v !== undefined && v !== null) search.set(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

/** An id as one URL path segment: encoded, and refused when empty or a dot segment. */
function idSegment(id: unknown): string {
  const segment = encodeURIComponent(String(id));
  if (segment === '' || segment === '.' || segment === '..') {
    throw new Error('Formio id is not a valid path segment');
  }
  return segment;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FormioForm = Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FormioSubmission = Record<string, any>;

export interface FormioCommunityEditionAPIv5Options {
  baseUrl: string;
  username: string;
  password: string;
  actor?: string;
  /** Budget for one call, its re-login and its retry. Unset falls back to HTTP_OUTBOUND_TIMEOUT_MS. */
  timeoutMs?: number;
}

const timedOut = (what: string): Error => new Error(`Formio ${what} timed out`);

export class FormioCommunityEditionAPIv5Client {
  private readonly _baseUrl: string;
  private readonly username: string;
  private readonly password: string;
  private readonly actor: string | undefined;
  private readonly timeoutMs: number;
  private token: string | null = null;

  constructor(options: FormioCommunityEditionAPIv5Options) {
    this._baseUrl = options.baseUrl.replace(/\/$/, '');
    this.username = options.username;
    this.password = options.password;
    this.actor = options.actor;
    this.timeoutMs = resolveTimeoutMs(options.timeoutMs, TIMEOUT_LABEL);
  }

  /** The call's own budget, cut short by the caller's signal when one is given. */
  private budget(signal?: AbortSignal): AbortSignal {
    const own = AbortSignal.timeout(this.timeoutMs);
    return signal ? AbortSignal.any([own, signal]) : own;
  }

  async login(budget = this.budget()): Promise<void> {
    const body = JSON.stringify({ data: { email: this.username, password: this.password } });
    const loginPaths = ['/admin/login', '/user/login'];
    // In order, stopping at the first path that logs in.
    const tryPath = async (index: number, lastError: Error | null): Promise<string> => {
      if (index === loginPaths.length) throw lastError ?? new Error('Formio login failed');
      const url = `${this._baseUrl}${loginPaths[index]}`;
      const init = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: budget,
      };
      let res: Response;
      let text: string;
      try {
        res = await fetch(url, init);
        text = await res.text();
      } catch (err) {
        if (budget.aborted) throw timedOut('login');
        const message = err instanceof Error ? err.message : err;
        return tryPath(index + 1, new Error(`Formio login request failed: ${message}`));
      }
      if (!res.ok) {
        return tryPath(index + 1, new Error(`Formio login failed ${res.status}: ${text}`));
      }
      const jwt = res.headers.get('x-jwt-token');
      if (!jwt) {
        return tryPath(index + 1, new Error('Formio login response missing x-jwt-token header'));
      }
      return jwt;
    };
    this.token = await tryPath(0, null);
  }

  getToken(): string | null {
    return this.token;
  }

  static async loginWithCredentials(
    baseUrl: string,
    email: string,
    password: string,
  ): Promise<string> {
    const client = new FormioCommunityEditionAPIv5Client({
      baseUrl: baseUrl.replace(/\/$/, ''),
      username: email,
      password,
    });
    await client.login();
    const token = client.getToken();
    if (!token) throw new Error('Formio login did not return a token');
    return token;
  }

  /** Used to avoid a login/retry loop for the Formio proxy’s no-admin fallback client (empty credentials). */
  private hasAdminCredentials(): boolean {
    return Boolean(this.username && this.password);
  }

  private async performFetch(
    url: string,
    method: string,
    body: string | undefined,
    budget: AbortSignal,
  ): Promise<{ ok: boolean; status: number; text: string }> {
    const token = this.token ?? undefined;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    if (token) headers['x-jwt-token'] = token;
    try {
      const res = await fetch(url, { method, headers, body, signal: budget });
      const text = await res.text();
      return { ok: res.ok, status: res.status, text };
    } catch (err) {
      if (budget.aborted) throw timedOut(`${method} request`);
      throw err;
    }
  }

  /**
   * Authenticates with `this.token` (the admin JWT from `login()`) as `x-jwt-token`.
   *
   * **HTTP 440** is treated as admin JWT expiry: clear `this.token`, `login()` once, and retry the same
   * request once.
   *
   * The call, the re-login and the retry share one budget; `signal` cuts it short.
   */
  private async request<T>(
    path: string,
    method: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const url = `${this._baseUrl}${path}`;
    const serializedBody = body !== undefined ? JSON.stringify(body) : undefined;
    const budget = this.budget(signal);

    let response = await this.performFetch(url, method, serializedBody, budget);
    // An expired session (440) re-logs in and retries once.
    if (!response.ok && response.status === 440 && this.hasAdminCredentials()) {
      this.token = null;
      await this.login(budget);
      response = await this.performFetch(url, method, serializedBody, budget);
    }
    const { ok, status, text } = response;
    if (!ok) throw new FormioApiError(status, text, url);
    if (status === 204 || !text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return undefined as T;
    }
  }

  async loadForms(query?: FormioQuery, signal?: AbortSignal): Promise<FormioForm[]> {
    const qs = buildQueryString(query);
    const result = await this.request<FormioForm[] | FormioForm>(
      `/form${qs}`,
      'GET',
      undefined,
      signal,
    );
    return Array.isArray(result) ? result : [];
  }

  async loadForm(formId: string, query?: FormioQuery): Promise<FormioForm | null> {
    const qs = buildQueryString(query);
    return this.request<FormioForm | null>(`/form/${idSegment(formId)}${qs}`, 'GET');
  }

  async saveForm(data: FormioForm, signal?: AbortSignal): Promise<FormioForm> {
    if (data._id) {
      return this.request<FormioForm>(`/form/${idSegment(data._id)}`, 'PUT', data, signal);
    }
    return this.request<FormioForm>('/form', 'POST', data, signal);
  }

  async deleteForm(formId: string, signal?: AbortSignal): Promise<void> {
    await this.request(`/form/${idSegment(formId)}`, 'DELETE', undefined, signal);
  }

  async loadSubmissions(
    formId: string,
    query?: FormioQuery,
    signal?: AbortSignal,
  ): Promise<FormioSubmission[]> {
    const qs = buildQueryString(query);
    const result = await this.request<FormioSubmission[] | FormioSubmission>(
      `/form/${idSegment(formId)}/submission${qs}`,
      'GET',
      undefined,
      signal,
    );
    return Array.isArray(result) ? result : [];
  }

  async loadSubmission(
    formId: string,
    submissionId: string,
    query?: FormioQuery,
  ): Promise<FormioSubmission | null> {
    const qs = buildQueryString(query);
    return this.request<FormioSubmission | null>(
      `/form/${idSegment(formId)}/submission/${idSegment(submissionId)}${qs}`,
      'GET',
    );
  }

  async saveSubmission(
    formId: string,
    data: FormioSubmission,
    query?: FormioQuery,
  ): Promise<FormioSubmission> {
    const qs = buildQueryString(query);
    if (data._id) {
      return this.request<FormioSubmission>(
        `/form/${idSegment(formId)}/submission/${idSegment(data._id)}${qs}`,
        'PUT',
        data,
      );
    }
    return this.request<FormioSubmission>(
      `/form/${idSegment(formId)}/submission${qs}`,
      'POST',
      data,
    );
  }

  async deleteSubmission(formId: string, submissionId: string): Promise<void> {
    await this.request(
      `/form/${idSegment(formId)}/submission/${idSegment(submissionId)}`,
      'DELETE',
    );
  }

  async loadRoles(query?: FormioQuery): Promise<{ _id: string; title?: string; name?: string }[]> {
    const qs = buildQueryString(query);
    const result = await this.request<{ _id: string; title?: string; name?: string }[]>(
      `/role${qs}`,
      'GET',
    );
    return Array.isArray(result) ? result : [];
  }

  async loadProject(): Promise<Record<string, unknown> & { access?: unknown[] }> {
    const project = await this.request<Record<string, unknown>>('', 'GET');
    if (project && typeof project === 'object' && !Array.isArray(project)) {
      return project as Record<string, unknown> & { access?: unknown[] };
    }
    const accessInfo = await this.loadAccessInfo().catch(() => ({}));
    return {
      access: [],
      ...(accessInfo && typeof accessInfo === 'object' && !Array.isArray(accessInfo)
        ? accessInfo
        : {}),
    } as Record<string, unknown> & { access?: unknown[] };
  }

  async currentUser(): Promise<Record<string, unknown> | null> {
    return this.request<Record<string, unknown> | null>('/current', 'GET');
  }

  async loadAccessInfo(): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('/access', 'GET');
  }

  async logout(): Promise<unknown> {
    return this.request('/logout', 'GET');
  }

  /**
   * GET /health — whitelisted, no auth. CE returns 200 when healthy (DB + schema OK).
   * 400 = unhealthy or "Invalid alias" if the server does not reserve "health" in
   * config.reservedForms. At deployment, add "health" to reservedForms in NODE_CONFIG.
   */
  async healthCheck(): Promise<{ ok: boolean; message?: string }> {
    try {
      await this.request<unknown>('/health', 'GET');
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

function getClientOptions(config: PluginConfigReader): FormioCommunityEditionAPIv5Options {
  return {
    baseUrl: config.getRequired('ADMIN_API_URL'),
    username: config.getRequired('ADMIN_USERNAME'),
    password: config.getRequired('ADMIN_PASSWORD'),
    timeoutMs: config.getOptionalNumber('TIMEOUT_MS'),
  };
}

let authenticatedClient: FormioCommunityEditionAPIv5Client | null = null;
let authenticatedClientConfigKey: string | null = null;
let authenticatedClientInit: Promise<FormioCommunityEditionAPIv5Client | null> | null = null;

/**
 * Returns a lazily-initialized authenticated client for the given plugin config.
 * Caches by config identity (same config reference reuses client). All options from config.
 */
export async function getAuthenticatedFormioClient(
  config: PluginConfigReader,
): Promise<FormioCommunityEditionAPIv5Client | null> {
  const baseUrl = config.getOptional('ADMIN_API_URL');
  const username = config.getOptional('ADMIN_USERNAME');
  const password = config.getOptional('ADMIN_PASSWORD');
  if (!baseUrl || !username || !password) return null;
  const key = `${baseUrl}:${username}`;
  if (authenticatedClient && authenticatedClientConfigKey === key) return authenticatedClient;
  if (authenticatedClientInit) {
    try {
      const client = await authenticatedClientInit;
      if (client && authenticatedClientConfigKey === key) return client;
    } catch {
      authenticatedClientInit = null;
      authenticatedClient = null;
      authenticatedClientConfigKey = null;
    }
  }
  // Outside the guarded login, so a bad timeout setting throws instead of reading as unavailable.
  const client = new FormioCommunityEditionAPIv5Client(getClientOptions(config));
  authenticatedClientInit = (async () => {
    await client.login();
    authenticatedClient = client;
    authenticatedClientConfigKey = key;
    return client;
  })();
  try {
    return await authenticatedClientInit;
  } catch {
    authenticatedClientInit = null;
    authenticatedClient = null;
    authenticatedClientConfigKey = null;
    return null;
  }
}

export async function verifyFormioAuth(config: PluginConfigReader): Promise<{
  ok: boolean;
  hasToken?: boolean;
  error?: string;
  baseUrl?: string;
  username?: string;
}> {
  const baseUrl = config.getOptional('ADMIN_API_URL');
  const username = config.getOptional('ADMIN_USERNAME');
  const password = config.getOptional('ADMIN_PASSWORD');
  if (!username || !password) {
    return {
      ok: false,
      error: 'ADMIN_USERNAME or ADMIN_PASSWORD not set',
      baseUrl: baseUrl ?? undefined,
    };
  }
  if (!baseUrl) {
    return { ok: false, error: 'ADMIN_API_URL not set' };
  }
  try {
    const client = new FormioCommunityEditionAPIv5Client({
      baseUrl,
      username,
      password,
      timeoutMs: config.getOptionalNumber('TIMEOUT_MS'),
    });
    await client.login();
    return {
      ok: true,
      hasToken: !!client.getToken(),
      baseUrl,
      username: `${username.slice(0, 3)}***`,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      baseUrl,
    };
  }
}
