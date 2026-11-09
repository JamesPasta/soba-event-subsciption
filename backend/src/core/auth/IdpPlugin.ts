/**
 * IdP (identity provider) plugin contract.
 * Plugins implement this contract; auth layer discovers and wires them.
 */
import type { Request } from 'express';
import type { PluginConfigReader } from '../config/pluginConfig';
import type { NormalizedProfile, IdpAttributes } from './jwtClaims';

/** Result of mapping a validated token payload to the common user shape. */
export interface IdpMapPayloadResult {
  subject: string;
  providerCode: string;
  profile: NormalizedProfile;
  idpAttributes: IdpAttributes;
  /**
   * If true, the IdP indicates this user is a SOBA platform admin (e.g. role: soba_admin).
   * Applied to the soba_admin table on each request. Omit when the IdP does not convey admin; false
   * revokes this IdP's grant.
   */
  sobaAdmin?: boolean;
}

/** Per-request claim mapper: token payload → common user shape. Provided by each IdP plugin. */
export interface IdpClaimMapper {
  mapPayload(payload: Record<string, unknown>): IdpMapPayloadResult;
}

/** Definition discovered from a plugin directory; used to create middleware and mapper. */
export interface IdpPluginDefinition {
  readonly code: string;
  createAuthMiddleware(
    config: PluginConfigReader,
  ): (req: Request, res: unknown, next: (err?: unknown) => void) => void;
  createClaimMapper(config: PluginConfigReader): IdpClaimMapper;
}

/** The bearer token from the Authorization header, or null. No other transport is read. */
export function getToken(req: Request): string | null {
  const parts = req.headers.authorization?.split(' ') ?? [];
  return parts.length === 2 && parts[0].toLowerCase() === 'bearer' && parts[1] ? parts[1] : null;
}
