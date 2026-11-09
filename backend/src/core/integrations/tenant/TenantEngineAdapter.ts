import type { Tenant } from '@soba/lib';
import type { IdpAttributes } from '../../auth/jwtClaims';

/** Result of a tenant engine readiness check; no config or credentials are exposed. */
export interface TenantEngineReadinessResult {
  ok: boolean;
  message?: string;
}

export interface GetTenantsInput {
  /** The caller's bearer token, without the scheme. */
  token: string;
  claims: IdpAttributes;
}

export interface TenantEngineAdapter {
  /** Optional: report whether the engine is reachable (readiness). No config in result. */
  readinessCheck?(): Promise<TenantEngineReadinessResult>;
  /** The caller's tenants. Throws an AppError when the engine cannot answer. */
  getTenants(input: GetTenantsInput): Promise<Tenant[]>;
}
