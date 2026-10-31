jest.mock('../../../src/core/db/repos/userSearchRepo', () => ({
  searchSobaUsers: jest.fn(),
}));
jest.mock('../../../src/core/db/repos/identityProviderRepo', () => ({
  listLoginIdentityProviders: jest.fn(),
}));

import { searchSobaUsers } from '../../../src/core/db/repos/userSearchRepo';
import { listLoginIdentityProviders } from '../../../src/core/db/repos/identityProviderRepo';
import { userSearchPluginDefinition } from '../../../src/plugins/user-search-soba';
import { SobaUserSearchAdapter } from '../../../src/plugins/user-search-soba/sobaUserSearchAdapter';

// Trimmed profiles and attributes for an Azure IDIR and a BCeID Business user.
const idirRow = {
  subject: 'f0e1d2c3@azureidir',
  profile: {
    displayName: 'Smith, Alice CITZ:EX',
    email: 'alice@example.com',
    firstName: 'Alice',
    lastName: 'Smith',
    idir_username: 'ASMITH',
    bceid_username: null,
  },
  idpAttributes: { idir_user_guid: 'F0E1D2C3', identity_provider: 'azureidir' },
};
const bceidRow = {
  subject: 'a1b2@bceidbusiness',
  profile: {
    displayName: 'Bob Builder',
    email: 'bob@example.com',
    firstName: 'Bob',
    lastName: '',
    bceid_username: 'bobco',
  },
  idpAttributes: { bceid_user_guid: 'A1B2', bceid_username: 'bobco' },
};

describe('user-search-soba adapter', () => {
  beforeEach(() => jest.clearAllMocks());

  it('declares the plugin', () => {
    expect(userSearchPluginDefinition.code).toBe('user-search-soba');
    expect(userSearchPluginDefinition.metadata).toEqual({
      code: 'user-search-soba',
      name: 'Soba user search',
    });
  });

  it('searches every active login provider by every filter', async () => {
    jest.mocked(listLoginIdentityProviders).mockResolvedValue([
      { code: 'azureidir', name: 'IDIR - MFA' },
      { code: 'bceidbusiness', name: 'BCeID Business' },
    ]);

    await expect(new SobaUserSearchAdapter().capabilities()).resolves.toEqual([
      { identityProvider: 'azureidir', fields: ['email', 'firstName', 'lastName', 'guid'] },
      { identityProvider: 'bceidbusiness', fields: ['email', 'firstName', 'lastName', 'guid'] },
    ]);
  });

  it('passes the request to the query and maps stored profiles to hits', async () => {
    jest.mocked(searchSobaUsers).mockResolvedValue([idirRow]);
    const request = { identityProvider: 'azureidir', filters: { lastName: 'Smith' }, limit: 25 };

    const result = await new SobaUserSearchAdapter().search(request);

    expect(searchSobaUsers).toHaveBeenCalledWith(request);
    expect(result).toEqual({
      hits: [
        {
          identityProvider: 'azureidir',
          subject: 'f0e1d2c3@azureidir',
          guid: 'F0E1D2C3',
          username: 'ASMITH',
          displayName: 'Smith, Alice CITZ:EX',
          firstName: 'Alice',
          lastName: 'Smith',
          email: 'alice@example.com',
        },
      ],
      truncated: false,
    });
  });

  it('reads the BCeID guid and username, and sends blank or missing fields as null', async () => {
    jest
      .mocked(searchSobaUsers)
      .mockResolvedValue([
        bceidRow,
        { subject: 'x@bceidbusiness', profile: null, idpAttributes: 'not an object' },
      ]);

    const { hits } = await new SobaUserSearchAdapter().search({
      identityProvider: 'bceidbusiness',
      filters: { firstName: 'Bo' },
      limit: 25,
    });

    expect(hits[0]).toMatchObject({ guid: 'A1B2', username: 'bobco', lastName: null });
    expect(hits[1]).toEqual({
      identityProvider: 'bceidbusiness',
      subject: 'x@bceidbusiness',
      guid: null,
      username: null,
      displayName: null,
      firstName: null,
      lastName: null,
      email: null,
    });
  });

  it('takes the guid from the subject for a user made from user search, who has no attributes yet', async () => {
    const guid = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
    jest.mocked(searchSobaUsers).mockResolvedValue([
      {
        subject: `${guid}@azureidir`,
        profile: { ...idirRow.profile, idir_username: 'JSMITH' },
        idpAttributes: null,
      },
    ]);

    const { hits } = await new SobaUserSearchAdapter().search({
      identityProvider: 'azureidir',
      filters: { guid },
      limit: 25,
    });

    expect(hits[0]).toMatchObject({ guid, username: 'JSMITH' });
  });

  it('returns at most the limit and says when the query found more', async () => {
    jest.mocked(searchSobaUsers).mockResolvedValue([idirRow, bceidRow, idirRow]);

    const result = await new SobaUserSearchAdapter().search({
      identityProvider: 'azureidir',
      filters: { email: 'al' },
      limit: 2,
    });

    expect(result.hits).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });
});
