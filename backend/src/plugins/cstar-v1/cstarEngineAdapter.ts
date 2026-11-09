import { z } from 'zod';
import { TenantSchema, type Tenant } from '@soba/lib';
import type { PluginConfigReader } from '../../core/config/pluginConfig';
import type { IdpAttributes } from '../../core/auth/jwtClaims';
import type {
  GetTenantsInput,
  TenantEngineAdapter,
  TenantEngineReadinessResult,
} from '../../core/integrations/tenant/TenantEngineAdapter';
import { HttpClientError, joinUrl, resolveTimeoutMs } from '../../core/http/httpClient';
import { ServiceUnavailableError } from '../../core/errors';
import { log } from '../../core/logging';

const PLUGIN = 'cstar-v1';
const SERVICE = 'CSTAR';
const HEALTH_PATH = 'health';
const tenantsPath = (userId: string) => `users/${encodeURIComponent(userId)}/tenants`;

const IDIR_PROVIDERS = new Set(['idir', 'azureidir']);

const HealthResponseSchema = z.object({ apiStatus: z.string() });

const TenantsResponseSchema = z.object({
  data: z.object({ tenants: z.array(TenantSchema) }),
});

/**
 * CSTAR's user id for the caller, or null when CSTAR does not serve the caller's identity provider.
 * Mirrors CSTAR's own check: IDIR, Azure IDIR, BCeID Business, or BCeID Both with a business guid.
 */
export function resolveCstarUserId(claims: IdpAttributes): string | null {
  const rawProvider = claims.idp ?? claims.identity_provider;
  const provider = typeof rawProvider === 'string' ? rawProvider : '';
  const supported =
    IDIR_PROVIDERS.has(provider) ||
    provider === 'bceidbusiness' ||
    (provider === 'bceidboth' && Boolean(claims.bceid_business_guid));
  if (!supported) return null;
  const userId = claims.idir_user_guid ?? claims.bceid_user_guid;
  return typeof userId === 'string' && userId ? userId : null;
}

/** CSTAR tenants for the signed-in user, fetched with the caller's own token. */
export class CstarEngineAdapter implements TenantEngineAdapter {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config: PluginConfigReader) {
    this.baseUrl = config.getRequired('API_BASE_URL');
    this.timeoutMs = resolveTimeoutMs(
      config.getOptionalNumber('TIMEOUT_MS'),
      'PLUGIN_CSTAR_V1_TIMEOUT_MS',
    );
  }

  /**
   * Unauthenticated GET /health. Only CSTAR's JSON health body counts: a base URL missing /api
   * reaches the CSTAR frontend, which answers 200 with HTML.
   */
  async readinessCheck(): Promise<TenantEngineReadinessResult> {
    try {
      const res = await this.get(HEALTH_PATH);
      const body: unknown = await res.json().catch(() => undefined);
      if (!HealthResponseSchema.safeParse(body).success) {
        return { ok: false, message: `Unexpected ${SERVICE} health response` };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  async getTenants({ token, claims }: GetTenantsInput): Promise<Tenant[]> {
    const userId = resolveCstarUserId(claims);
    if (!userId) return [];

    let body: unknown;
    try {
      const res = await this.get(tenantsPath(userId), { Authorization: `Bearer ${token}` });
      body = await res.json();
    } catch (err) {
      const status = err instanceof HttpClientError ? err.status : undefined;
      const message = err instanceof Error ? err.message : String(err);
      log.warn({ plugin: PLUGIN, status, error: message }, 'CSTAR tenants request failed');
      // The caller sends no input, so a CSTAR 4xx is a 503 too; upstream detail stays out of the response.
      throw new ServiceUnavailableError(
        status ? `${SERVICE} error ${status}` : `${SERVICE} is unavailable`,
      );
    }

    const parsed = TenantsResponseSchema.safeParse(body);
    if (!parsed.success) {
      log.warn({ plugin: PLUGIN, error: parsed.error.message }, 'CSTAR tenants response invalid');
      throw new ServiceUnavailableError(`${SERVICE} returned an unexpected tenants response`);
    }
    return parsed.data.data.tenants;
  }

  /** GET under the base URL; a non-2xx response throws HttpClientError. */
  private async get(path: string, headers?: Record<string, string>): Promise<Response> {
    const url = joinUrl(this.baseUrl, path);
    const res = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new HttpClientError(res.status, res.statusText, text, url);
    }
    return res;
  }
}
