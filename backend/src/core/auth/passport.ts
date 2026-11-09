import type { Request, Response } from 'express';
import passport from 'passport';
import { findInOrder } from '../inOrder';
import { getIdpPlugins, type IdpPluginInstance } from './idpRegistry';
import type { IdpMapPayloadResult } from './IdpPlugin';

export const SOBA_PASSPORT_STRATEGY = 'soba-composite';

export interface AuthenticatedIdpPrincipal extends IdpMapPayloadResult {
  pluginCode: string;
  authPayload: Record<string, unknown>;
}

interface CompositeAuthResult {
  principal: AuthenticatedIdpPrincipal | null;
  lastError?: unknown;
}

function clearPluginAuthState(req: Request): void {
  delete req.decodedJwt;
  delete req.authPayload;
  delete req.idpType;
  delete req.idpPluginCode;
}

function runPluginMiddleware(
  plugin: IdpPluginInstance,
  req: Request,
  res: Response,
): Promise<unknown> {
  return new Promise((resolve) => {
    try {
      plugin.middleware(req, res, (err?: unknown) => resolve(err));
    } catch (err) {
      resolve(err);
    }
  });
}

function buildPrincipal(plugin: IdpPluginInstance, req: Request): AuthenticatedIdpPrincipal | null {
  if (req.idpPluginCode !== plugin.code) return null;
  if (!req.authPayload || typeof req.authPayload !== 'object') return null;

  return {
    pluginCode: plugin.code,
    authPayload: req.authPayload,
    ...plugin.claimMapper.mapPayload(req.authPayload),
  };
}

export async function authenticateWithIdpPlugins(
  req: Request,
  res: Response,
): Promise<CompositeAuthResult> {
  let lastError: unknown;

  // One plugin at a time: each one writes to req.
  const principal = await findInOrder(getIdpPlugins(), async (plugin) => {
    clearPluginAuthState(req);
    const err = await runPluginMiddleware(plugin, req, res);
    if (err) {
      lastError = err;
      return undefined;
    }
    return buildPrincipal(plugin, req);
  });
  if (principal) {
    return { principal };
  }

  clearPluginAuthState(req);
  return { principal: null, lastError };
}

class CompositeIdpStrategy extends passport.Strategy {
  name = SOBA_PASSPORT_STRATEGY;

  authenticate(req: Request): void {
    const res = req.res as Response | undefined;
    if (!res) {
      this.error(new Error('Response object is required for authentication'));
      return;
    }

    authenticateWithIdpPlugins(req, res)
      .then(({ principal, lastError }) => {
        if (principal) {
          this.success(principal);
          return;
        }

        const statusErr = lastError as { status?: number } | undefined;
        if (statusErr?.status === 401) {
          this.fail({ error: lastError, status: 401 }, 401);
          return;
        }

        this.fail({ status: 401, message: 'Error occurred during authentication' }, 401);
      })
      .catch((err) => this.error(err));
  }
}

let passportConfigured = false;

export function initializePassport(): void {
  if (passportConfigured) return;
  passport.use(SOBA_PASSPORT_STRATEGY, new CompositeIdpStrategy());
  passportConfigured = true;
}

export function resetPassportForTests(): void {
  if (!passportConfigured) return;
  passport.unuse(SOBA_PASSPORT_STRATEGY);
  passportConfigured = false;
}
