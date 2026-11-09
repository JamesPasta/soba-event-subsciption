jest.mock('../../../src/core/db/repos/identityLookup', () => ({
  findSignInState: jest.fn(),
}));
jest.mock('../../../src/core/db/repos/membershipRepo', () => ({
  completeFirstSignIn: jest.fn(),
  findOrCreateUserByIdentity: jest.fn(),
  updateIdentityAttributes: jest.fn(),
}));
jest.mock('../../../src/core/db/repos/sobaAdminRepo', () => ({
  SOBA_ADMIN_SOURCE_IDP: 'idp',
  grantSobaAdminFromIdp: jest.fn(),
  repointSobaAdminFromIdp: jest.fn(),
  revokeSobaAdminFromIdp: jest.fn(),
  isSobaAdmin: jest.fn(),
}));

import type { IdpMapPayloadResult } from '../../../src/core/auth/IdpPlugin';
import { findSignInState, type SignInState } from '../../../src/core/db/repos/identityLookup';
import {
  completeFirstSignIn,
  findOrCreateUserByIdentity,
  updateIdentityAttributes,
} from '../../../src/core/db/repos/membershipRepo';
import {
  grantSobaAdminFromIdp,
  isSobaAdmin,
  repointSobaAdminFromIdp,
  revokeSobaAdminFromIdp,
} from '../../../src/core/db/repos/sobaAdminRepo';
import { ForbiddenError } from '../../../src/core/errors';
import { resolveSignedInActor, sobaAdminChange } from '../../../src/core/services/actorIdentity';

const idpGrant = (identityProviderCode: string) => ({ source: 'idp', identityProviderCode });
const DIRECT = { source: 'direct', identityProviderCode: null };

describe('sobaAdminChange', () => {
  it.each([
    ['no row, admin', null, true, 'grant'],
    ['no row, not admin', null, false, 'none'],
    ['IdP grant from this IdP, admin', idpGrant('bcgov-sso'), true, 'none'],
    ['IdP grant from this IdP, not admin', idpGrant('bcgov-sso'), false, 'revoke'],
    ['IdP grant from another IdP, admin', idpGrant('other'), true, 'repoint'],
    ['IdP grant from another IdP, not admin', idpGrant('other'), false, 'none'],
    ['direct grant, admin', DIRECT, true, 'none'],
    ['direct grant, not admin', DIRECT, false, 'none'],
  ])('%s: %s', (_case, row, isAdmin, expected) => {
    expect(sobaAdminChange(row, 'bcgov-sso', isAdmin)).toBe(expected);
  });
});

const mockState = jest.mocked(findSignInState);
const mockCreate = jest.mocked(findOrCreateUserByIdentity);
const mockAttributes = jest.mocked(updateIdentityAttributes);
const mockFirstSignIn = jest.mocked(completeFirstSignIn);
const mockGrant = jest.mocked(grantSobaAdminFromIdp);
const mockRepoint = jest.mocked(repointSobaAdminFromIdp);
const mockRevoke = jest.mocked(revokeSobaAdminFromIdp);
const mockIsAdmin = jest.mocked(isSobaAdmin);

const mapped = (changes: Partial<IdpMapPayloadResult> = {}): IdpMapPayloadResult => ({
  subject: 'sub-1',
  providerCode: 'AzureIDIR',
  profile: { displayName: 'Jo' },
  idpAttributes: { idir_username: 'JO' },
  sobaAdmin: true,
  ...changes,
});

const state = (changes: Partial<SignInState> = {}): SignInState => ({
  providerActive: true,
  identityId: 'identity-1',
  userId: 'user-1',
  attributesCurrent: true,
  firstSignInPending: false,
  admin: idpGrant('bcgov-sso'),
  ...changes,
});

const followUps = () => [
  mockCreate,
  mockAttributes,
  mockFirstSignIn,
  mockGrant,
  mockRepoint,
  mockRevoke,
  mockIsAdmin,
];

describe('resolveSignedInActor', () => {
  beforeEach(() => jest.resetAllMocks());

  it('writes nothing for a caller whose stored details match the token', async () => {
    mockState.mockResolvedValue(state());

    await expect(resolveSignedInActor('bcgov-sso', mapped(), 'JO')).resolves.toEqual({
      actorId: 'user-1',
      isSobaAdmin: true,
    });
    expect(mockState).toHaveBeenCalledWith('azureidir', 'sub-1', { idir_username: 'JO' });
    followUps().forEach((write) => expect(write).not.toHaveBeenCalled());
  });

  it('stores IdP attributes that differ from the stored ones', async () => {
    mockState.mockResolvedValue(state({ attributesCurrent: false }));

    await resolveSignedInActor('bcgov-sso', mapped(), 'JO');

    expect(mockAttributes).toHaveBeenCalledWith('identity-1', { idir_username: 'JO' });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('completes the first sign-in of an identity made from directory details', async () => {
    mockState.mockResolvedValue(state({ attributesCurrent: false, firstSignInPending: true }));

    await expect(resolveSignedInActor('bcgov-sso', mapped(), 'JO')).resolves.toMatchObject({
      actorId: 'user-1',
    });
    expect(mockFirstSignIn).toHaveBeenCalledWith({
      identityId: 'identity-1',
      userId: 'user-1',
      subject: 'sub-1',
      profile: { displayName: 'Jo' },
      idpAttributes: { idir_username: 'JO' },
    });
    expect(mockAttributes).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('creates the user for an identity not seen before, then applies the admin claim', async () => {
    mockState.mockResolvedValue(state({ identityId: null, userId: null, admin: null }));
    mockCreate.mockResolvedValue('user-new');

    await expect(resolveSignedInActor('bcgov-sso', mapped(), 'JO')).resolves.toEqual({
      actorId: 'user-new',
      isSobaAdmin: true,
    });
    expect(mockCreate).toHaveBeenCalledWith(
      'azureidir',
      'sub-1',
      { displayName: 'Jo' },
      { idir_username: 'JO' },
    );
    expect(mockAttributes).not.toHaveBeenCalled();
    expect(mockGrant).toHaveBeenCalledWith('user-new', 'bcgov-sso', 'JO');
  });

  it.each([
    ['unknown', null],
    ['inactive', state({ providerActive: false })],
  ])('refuses an %s identity provider before any write', async (_case, found) => {
    mockState.mockResolvedValue(found);

    await expect(resolveSignedInActor('bcgov-sso', mapped(), 'JO')).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    followUps().forEach((write) => expect(write).not.toHaveBeenCalled());
  });

  it('moves an IdP grant to the IdP that reports it', async () => {
    mockState.mockResolvedValue(state({ admin: idpGrant('other') }));
    mockRepoint.mockResolvedValue(true);

    await expect(resolveSignedInActor('BCGov-SSO', mapped(), 'JO')).resolves.toMatchObject({
      isSobaAdmin: true,
    });
    expect(mockRepoint).toHaveBeenCalledWith('user-1', 'bcgov-sso', 'JO');
    expect(mockIsAdmin).not.toHaveBeenCalled();
  });

  it('reads the row again when a repoint moves nothing', async () => {
    mockState.mockResolvedValue(state({ admin: idpGrant('other') }));
    mockRepoint.mockResolvedValue(false);
    mockIsAdmin.mockResolvedValue(true);

    await expect(resolveSignedInActor('bcgov-sso', mapped(), 'JO')).resolves.toMatchObject({
      isSobaAdmin: true,
    });
    expect(mockIsAdmin).toHaveBeenCalledWith('user-1');
  });

  it('revokes the IdP grant when the IdP stops reporting admin', async () => {
    mockState.mockResolvedValue(state());
    mockRevoke.mockResolvedValue(true);

    await expect(
      resolveSignedInActor('bcgov-sso', mapped({ sobaAdmin: false }), 'JO'),
    ).resolves.toMatchObject({ isSobaAdmin: false });
    expect(mockRevoke).toHaveBeenCalledWith('user-1', 'bcgov-sso');
    expect(mockIsAdmin).not.toHaveBeenCalled();
  });

  it('reads the row again when a revoke removes nothing', async () => {
    mockState.mockResolvedValue(state());
    mockRevoke.mockResolvedValue(false);
    mockIsAdmin.mockResolvedValue(true);

    await expect(
      resolveSignedInActor('bcgov-sso', mapped({ sobaAdmin: false }), 'JO'),
    ).resolves.toMatchObject({ isSobaAdmin: true });
  });

  it('takes the admin flag from the row when the IdP reports no claim', async () => {
    mockState.mockResolvedValue(state({ admin: DIRECT }));

    await expect(
      resolveSignedInActor('bcgov-sso', mapped({ sobaAdmin: undefined }), 'JO'),
    ).resolves.toMatchObject({ isSobaAdmin: true });
    followUps().forEach((write) => expect(write).not.toHaveBeenCalled());
  });
});
