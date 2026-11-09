import { sanitizeIdpAttributes } from '../../../src/plugins/idp-bcgov-sso/jwksHelpers';

describe('sanitizeIdpAttributes', () => {
  it('keeps identity and profile claims, and drops session and client claims', () => {
    const stored = sanitizeIdpAttributes({
      sub: 'abc@idir',
      idir_user_guid: 'ABC123',
      idir_username: 'JDOE',
      email: 'jane.doe@gov.bc.ca',
      name: 'Jane Doe',
      iss: 'https://loginproxy.gov.bc.ca/auth/realms/standard',
      exp: 1,
      iat: 1,
      jti: 'token-1',
      sid: 'session-1',
      azp: 'soba-frontend',
      aud: 'soba-frontend',
      scope: 'openid',
      client_roles: ['soba_admin'],
    });

    expect(stored).toEqual({
      sub: 'abc@idir',
      idir_user_guid: 'ABC123',
      idir_username: 'JDOE',
      email: 'jane.doe@gov.bc.ca',
      name: 'Jane Doe',
      iss: 'https://loginproxy.gov.bc.ca/auth/realms/standard',
    });
  });
});
