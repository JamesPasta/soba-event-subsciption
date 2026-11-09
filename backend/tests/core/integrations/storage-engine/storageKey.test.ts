import {
  isStoragePrefix,
  storedObjectName,
} from '../../../../src/core/integrations/storage-engine/storageKey';

describe('isStoragePrefix', () => {
  it.each(['attachments', 'templates', 'soba-dev', 'soba/dev', 'pr-156/templates', 'v2'])(
    'accepts %s',
    (value) => {
      expect(isStoragePrefix(value)).toBe(true);
    },
  );

  it.each([
    '',
    '../escape',
    'a/../b',
    '/leading',
    'trailing/',
    'Upper',
    'two--dashes',
    'sp ace',
    'a//b',
  ])('refuses %j', (value) => {
    expect(isStoragePrefix(value)).toBe(false);
  });
});

describe('storedObjectName', () => {
  it('is a uuid v7, different on every call', () => {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    const first = storedObjectName();
    expect(first).toMatch(uuid);
    expect(storedObjectName()).not.toBe(first);
  });
});
