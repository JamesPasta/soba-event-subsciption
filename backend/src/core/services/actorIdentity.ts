import type { IdpMapPayloadResult } from '../auth/IdpPlugin';
import { ForbiddenError } from '../errors';
import { findSignInState, type SobaAdminGrant } from '../db/repos/identityLookup';
import {
  completeFirstSignIn,
  findOrCreateUserByIdentity,
  updateIdentityAttributes,
} from '../db/repos/membershipRepo';
import {
  grantSobaAdminFromIdp,
  isSobaAdmin,
  repointSobaAdminFromIdp,
  revokeSobaAdminFromIdp,
  SOBA_ADMIN_SOURCE_IDP,
} from '../db/repos/sobaAdminRepo';

export type SobaAdminChange = 'none' | 'grant' | 'repoint' | 'revoke';

/**
 * What an IdP's admin claim changes on the user's platform admin row. A direct grant never changes;
 * an IdP grant follows the IdP reporting it, and only the IdP that gave it revokes it.
 */
export const sobaAdminChange = (
  row: SobaAdminGrant | null,
  idpCode: string,
  isAdmin: boolean,
): SobaAdminChange => {
  const fromIdp = row?.source === SOBA_ADMIN_SOURCE_IDP;
  if (!isAdmin) return fromIdp && row.identityProviderCode === idpCode ? 'revoke' : 'none';
  if (!row) return 'grant';
  return fromIdp && row.identityProviderCode !== idpCode ? 'repoint' : 'none';
};

/** Applies the admin claim, if the IdP reports one, and returns whether the user is an admin. */
async function applySobaAdminClaim(
  actorId: string,
  idpCode: string,
  claim: boolean | undefined,
  row: SobaAdminGrant | null,
  displayLabel: string | null,
): Promise<boolean> {
  if (claim === undefined) return row !== null;
  switch (sobaAdminChange(row, idpCode, claim)) {
    case 'grant':
      await grantSobaAdminFromIdp(actorId, idpCode, displayLabel);
      return true;
    case 'repoint':
      // Nothing moved means the row changed since the read: revoked, or made direct.
      return (
        (await repointSobaAdminFromIdp(actorId, idpCode, displayLabel)) || isSobaAdmin(actorId)
      );
    case 'revoke':
      // A row left in place is a direct grant made since the read.
      return (await revokeSobaAdminFromIdp(actorId, idpCode)) ? false : isSobaAdmin(actorId);
    default:
      return row !== null;
  }
}

/**
 * The app user and platform admin flag for a signed-in caller, from one read. Writes only what the
 * token changes: a new user, the profile at an identity's first sign-in, different IdP attributes,
 * or a different admin grant.
 */
export async function resolveSignedInActor(
  pluginCode: string,
  mapped: IdpMapPayloadResult,
  displayLabel: string | null,
): Promise<{ actorId: string; isSobaAdmin: boolean }> {
  const providerCode = mapped.providerCode.toLowerCase();
  const state = await findSignInState(providerCode, mapped.subject, mapped.idpAttributes);
  if (!state?.providerActive) {
    throw new ForbiddenError(`Identity provider '${providerCode}' is not enabled for sign-in`);
  }

  const actorId =
    state.userId ??
    (await findOrCreateUserByIdentity(
      providerCode,
      mapped.subject,
      mapped.profile,
      mapped.idpAttributes,
    ));
  if (state.identityId && state.firstSignInPending) {
    // Made from directory details: the token's profile replaces them.
    await completeFirstSignIn({
      identityId: state.identityId,
      userId: actorId,
      subject: mapped.subject,
      profile: mapped.profile,
      idpAttributes: mapped.idpAttributes,
    });
  } else if (state.identityId && !state.attributesCurrent) {
    await updateIdentityAttributes(state.identityId, mapped.idpAttributes);
  }

  const isAdmin = await applySobaAdminClaim(
    actorId,
    pluginCode.toLowerCase(),
    mapped.sobaAdmin,
    state.admin,
    displayLabel,
  );
  return { actorId, isSobaAdmin: isAdmin };
}
