import { z } from 'zod';
import type { FormCreateCapability, ListTenantsResponse, MeResponse } from '@soba/lib';
import { findAppUserById, updateAppUserProfile } from '../../db/repos/appUserRepo';
import { toAppUserView, type AppUserRow } from '../../db/appUserView';
import { canCreateWorkspaceByIdp } from '../../db/repos/idpGroupRepo';
import {
  actorBelongsToWorkspace,
  findPermittedWorkspace,
  hasActiveMembership,
} from '../../db/repos/membershipRepo';
import { FormCreatePermissions } from '../../db/codes';
import { profileHelpers, type IdpAttributes, type StoredProfile } from '../../auth/jwtClaims';
import {
  createDefaultTenantEngineAdapter,
  resolveDefaultTenantEngineCode,
} from '../../integrations/tenant/TenantEngineRegistry';
import type { TenantEngineAdapter } from '../../integrations/tenant/TenantEngineAdapter';
import { ForbiddenError, ServiceUnavailableError } from '../../errors';
import { log } from '../../logging';
import { PatchMeBodySchema } from './schema';

type PatchMeBody = z.infer<typeof PatchMeBodySchema>;

export class MeApiService {
  private async resolveDefaultWorkspaceId(
    actorId: string,
    profile: StoredProfile | null | undefined,
  ): Promise<string | null> {
    const stored = profileHelpers.getDefaultWorkspaceId(profile);
    if (!stored) return null;
    const belongs = await actorBelongsToWorkspace(stored, actorId);
    return belongs ? stored : null;
  }

  /** Same filters as the create-form workspace picker. */
  private async resolveFormCreate(actorId: string): Promise<FormCreateCapability> {
    const workspace = await findPermittedWorkspace(actorId, FormCreatePermissions);
    if (!workspace) return 'none';
    return workspace.disclaimerAccepted ? 'allowed' : 'disclaimer_required';
  }

  private async toResponse(
    user: AppUserRow,
    idpCode: string | null,
    isSobaAdmin: boolean,
  ): Promise<MeResponse> {
    const view = toAppUserView(user);
    // Independent lookups, run concurrently so /me (a bootstrap hot path) pays
    // one DB round-trip of latency, not one per lookup.
    const [defaultWorkspaceId, canCreateWorkspace, hasWorkspaces, formCreate] = await Promise.all([
      this.resolveDefaultWorkspaceId(view.id, user.profile as StoredProfile),
      canCreateWorkspaceByIdp(idpCode),
      hasActiveMembership(view.id),
      this.resolveFormCreate(view.id),
    ]);
    return {
      actor: {
        id: view.id,
        displayLabel: view.displayLabel,
        status: view.status,
      },
      profile: {
        displayName: view.displayName,
        email: view.email,
        preferredUsername: view.preferredUsername,
        idpCode,
      },
      preferences: {
        defaultWorkspaceId,
      },
      capabilities: {
        canCreateWorkspace,
        hasWorkspaces,
        formCreate,
        isSobaAdmin,
      },
    };
  }

  async get(actorId: string, idpCode: string | null, isSobaAdmin: boolean) {
    const user = await findAppUserById(actorId);
    if (!user) return null;
    return this.toResponse(user, idpCode, isSobaAdmin);
  }

  async patch(actorId: string, idpCode: string | null, body: PatchMeBody, isSobaAdmin: boolean) {
    const user = await findAppUserById(actorId);
    if (!user) return null;

    const { preferences } = body;
    if (preferences?.defaultWorkspaceId !== undefined && preferences.defaultWorkspaceId !== null) {
      const belongs = await actorBelongsToWorkspace(preferences.defaultWorkspaceId, actorId);
      if (!belongs) {
        throw new ForbiddenError('Not a member of that workspace');
      }
    }

    const existingProfile = (user.profile as StoredProfile | null) ?? {};
    const existingPreferences =
      existingProfile.preferences && typeof existingProfile.preferences === 'object'
        ? existingProfile.preferences
        : {};

    const nextPreferences = { ...existingPreferences };
    if (preferences?.defaultWorkspaceId !== undefined) {
      nextPreferences.defaultWorkspaceId = preferences.defaultWorkspaceId;
    }

    const nextProfile: StoredProfile = {
      ...existingProfile,
      preferences: nextPreferences,
    };

    const view = toAppUserView(user);
    const updatedBy = view.displayLabel ?? actorId;
    const updated = await updateAppUserProfile(actorId, nextProfile, updatedBy);
    if (!updated) return null;
    return this.toResponse(updated, idpCode, isSobaAdmin);
  }

  /** The caller's tenants from the default tenant engine, fetched with the caller's own token. */
  async listTenants(token: string, claims: IdpAttributes): Promise<ListTenantsResponse> {
    let adapter: TenantEngineAdapter;
    try {
      adapter = createDefaultTenantEngineAdapter();
    } catch (err) {
      // Missing config or an uninstalled default code; the detail names env vars, so it stays in the log.
      log.error(
        { err, engine: resolveDefaultTenantEngineCode() },
        'Tenant engine could not be created',
      );
      throw new ServiceUnavailableError('Tenant engine is unavailable');
    }
    const tenants = await adapter.getTenants({ token, claims });
    return { tenants };
  }
}

export const meApiService = new MeApiService();
