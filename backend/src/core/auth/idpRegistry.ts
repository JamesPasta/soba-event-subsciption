/**
 * IdP plugin selection and auth middleware wiring.
 */
import { Request, Response, NextFunction } from 'express';
import { ApiErrorCodes } from '@soba/lib';
import { authEnv } from '../config/authEnv';
import { createPluginConfigReader } from '../config/pluginConfig';
import type { IdpPluginDefinition, IdpClaimMapper } from './IdpPlugin';
import { getIdpPluginDefinitions } from '../integrations/plugins/PluginRegistry';

export interface IdpPluginInstance {
  code: string;
  middleware: (req: Request, res: Response, next: NextFunction) => void;
  claimMapper: IdpClaimMapper;
}

let idpDefinitionsCache: IdpPluginDefinition[] | null = null;

function discoverIdpDefinitions(): IdpPluginDefinition[] {
  if (idpDefinitionsCache) return idpDefinitionsCache;
  idpDefinitionsCache = getIdpPluginDefinitions();
  return idpDefinitionsCache;
}

let idpPluginsCache: IdpPluginInstance[] | null = null;

export function getIdpPlugins(): IdpPluginInstance[] {
  if (idpPluginsCache) return idpPluginsCache;
  const codes = authEnv.getIdpPlugins();
  const definitions = discoverIdpDefinitions();
  const byCode = new Map(definitions.map((d) => [d.code, d]));
  const result: IdpPluginInstance[] = [];
  for (const code of codes) {
    const def = byCode.get(code);
    if (!def) {
      throw new Error(
        `IdP plugin '${code}' is configured in IDP_PLUGINS but not found. Available: ${definitions.map((d) => d.code).join(', ') || '<none>'}`,
      );
    }
    const config = createPluginConfigReader(def.code);
    result.push({
      code: def.code,
      middleware: def.createAuthMiddleware(config) as (
        req: Request,
        res: Response,
        next: NextFunction,
      ) => void,
      claimMapper: def.createClaimMapper(config),
    });
  }
  idpPluginsCache = result;
  return result;
}

/** Composite auth middleware: try each IdP plugin in order; first success wins. */
export function createIdpAuthMiddleware(): (
  req: Request,
  res: Response,
  next: NextFunction,
) => void {
  const plugins = getIdpPlugins();
  return (req: Request, res: Response, next: NextFunction) => {
    let index = 0;
    const tryNext = (err?: unknown): void => {
      if (!err && (req as Request & { idpPluginCode?: string }).idpPluginCode) {
        return next();
      }
      if (index >= plugins.length) {
        const statusErr = err as { status?: number } | undefined;
        if (statusErr?.status === 401) return next(err);
        res.status(401).json({
          error: 'Unauthorized',
          code: ApiErrorCodes.unauthenticated,
          message: 'Error occurred during authentication',
          statusCode: 401,
        });
        return;
      }
      const { middleware } = plugins[index++];
      middleware(req, res, tryNext);
    };
    tryNext();
  };
}
