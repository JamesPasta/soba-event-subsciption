import { objectKey, ownedKey } from '../../../src/plugins/storage-s3/objectKey';

const input = { prefix: 'templates', workspaceId: 'ws1' };
const UUID = '[0-9a-f-]{36}';

describe('objectKey', () => {
  it('puts the feature prefix before the workspace, and ends in the stored object name', () => {
    expect(objectKey(undefined, input)).toMatch(new RegExp(`^templates/ws1/${UUID}$`));
  });

  it("puts the profile's root before the feature prefix", () => {
    expect(objectKey('soba/dev', input)).toMatch(new RegExp(`^soba/dev/templates/ws1/${UUID}$`));
  });
});

describe('ownedKey', () => {
  it('returns the key of a ref in the bucket and under the root', () => {
    expect(ownedKey('s3:bucket:dev/templates/ws1/a.docx', 'bucket', 'dev')).toBe(
      'dev/templates/ws1/a.docx',
    );
  });

  it('returns any key in the bucket when the profile has no root', () => {
    expect(ownedKey('s3:bucket:templates/ws1/a.docx', 'bucket', undefined)).toBe(
      'templates/ws1/a.docx',
    );
  });

  it.each([
    ['another bucket', 's3:other:dev/templates/ws1/a.docx'],
    ['another root', 's3:bucket:prod/templates/ws1/a.docx'],
    ['a root that only starts the same', 's3:bucket:dev-2/templates/ws1/a.docx'],
    ['a dot segment out of the root', 's3:bucket:dev/../prod/templates/ws1/a.docx'],
    ['another backend', 'local:dev/templates/ws1/a.docx'],
  ])('refuses a ref in %s', (_case, ref) => {
    expect(ownedKey(ref, 'bucket', 'dev')).toBeNull();
  });

  it('refuses a ref with no key', () => {
    expect(ownedKey('s3:bucket:', 'bucket', undefined)).toBeNull();
  });
});
