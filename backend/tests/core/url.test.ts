import { joinUrl, withoutQuery, withoutTrailingSlashes } from '../../src/core/url';

describe('withoutTrailingSlashes', () => {
  it('drops every trailing slash and nothing else', () => {
    expect(withoutTrailingSlashes('https://soba.example/designer//')).toBe(
      'https://soba.example/designer',
    );
    expect(withoutTrailingSlashes('https://soba.example/designer')).toBe(
      'https://soba.example/designer',
    );
  });
});

describe('joinUrl', () => {
  it('joins with exactly one slash regardless of stray slashes', () => {
    expect(joinUrl('http://x/api', 'v2')).toBe('http://x/api/v2');
    expect(joinUrl('http://x/api/', 'v2')).toBe('http://x/api/v2');
    expect(joinUrl('http://x/api/', '/v2')).toBe('http://x/api/v2');
  });
});

describe('withoutQuery', () => {
  it('drops the query string and leaves a URL without one alone', () => {
    expect(withoutQuery('http://svc.test/users?email=a&lastName=b')).toBe('http://svc.test/users');
    expect(withoutQuery('http://svc.test/users')).toBe('http://svc.test/users');
  });
});
