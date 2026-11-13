/**
 * IdP plugin that validates tokens from GitHub (e.g. gh auth login / gh auth token).
 * Uses GitHub's REST API to validate the token and fetch user info.
 */
import type { Request } from 'express';
import type { PluginConfigReader } from '../../core/config/pluginConfig';
import type {
  IdpPluginDefinition,
  IdpClaimMapper,
  IdpMapPayloadResult,
} from '../../core/auth/IdpPlugin';
import type { NormalizedProfile, IdpAttributes } from '../../core/auth/jwtClaims';
import { getToken } from '../../core/auth/IdpPlugin';
import { withoutTrailingSlashes } from '../../core/url';

const DEFAULT_GITHUB_API_URL = 'https://api.github.com';

/** GitHub /user response shape (subset we use). */
interface GitHubUser {
  login?: string;
  id?: number;
  name?: string | null;
  email?: string | null;
  avatar_url?: string;
  [key: string]: unknown;
}

function getApiUrl(config: PluginConfigReader): string {
  return config.getOptional('GITHUB_API_URL')?.trim() || DEFAULT_GITHUB_API_URL;
}

async function fetchUserWithToken(apiUrl: string, token: string): Promise<GitHubUser> {
  const base = withoutTrailingSlashes(apiUrl);
  const res = await fetch(`${base}/user`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API error ${res.status}: ${text || res.statusText}`);
  }
  return res.json() as Promise<GitHubUser>;
}

function buildProfile(user: GitHubUser): NormalizedProfile {
  const login = typeof user.login === 'string' ? user.login.trim() : null;
  const name = typeof user.name === 'string' ? user.name.trim() : null;
  const email =
    typeof user.email === 'string' && user.email.includes('@') ? user.email.trim() : null;
  const displayName = name || login;
  const preferredUsername = login || (user.id != null ? String(user.id) : null);
  const displayLabel = login || name || email || preferredUsername;
  return {
    displayName: displayName ?? null,
    email: email ?? null,
    preferredUsername: preferredUsername ?? null,
    displayLabel: displayLabel ?? null,
    name: name ?? null,
  };
}

/** Copy user object for idp_attributes; drop nothing (GitHub user is already safe). */
function toIdpAttributes(user: GitHubUser): IdpAttributes {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(user)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

class GithubClaimMapper implements IdpClaimMapper {
  mapPayload(payload: Record<string, unknown>): IdpMapPayloadResult {
    const user = payload as unknown as GitHubUser;
    const profile = buildProfile(user);
    const idpAttributes = toIdpAttributes(user);
    const subject = user.id != null ? String(user.id) : (user.login && String(user.login)) || '';
    return {
      subject,
      providerCode: 'github',
      profile,
      idpAttributes,
    };
  }
}

export const idpPluginDefinition: IdpPluginDefinition = {
  code: 'idp-github',

  createAuthMiddleware(config: PluginConfigReader) {
    const apiUrl = getApiUrl(config);
    return (req: Request, _res: unknown, next: (err?: unknown) => void) => {
      const token = getToken(req);
      if (!token || typeof token !== 'string') {
        return next();
      }
      fetchUserWithToken(apiUrl, token)
        .then((user) => {
          (req as Request & { authPayload?: Record<string, unknown> }).authPayload =
            user as unknown as Record<string, unknown>;
          (req as Request & { idpPluginCode?: string }).idpPluginCode = 'idp-github';
          next();
        })
        .catch((err) => next(err));
    };
  },

  // Config not used by this mapper; required by IdpPluginDefinition.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  createClaimMapper(config: PluginConfigReader): IdpClaimMapper {
    return new GithubClaimMapper();
  },
};
