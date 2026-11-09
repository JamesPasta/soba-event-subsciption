import { afterEach, describe, expect, it, vi } from 'vitest';
import { getBasePath, withBasePath } from '@/src/shared/config/basePath';

describe('getBasePath', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is empty when the app is served at the root', () => {
    vi.stubEnv('NEXT_PUBLIC_BASE_PATH', undefined);
    expect(getBasePath()).toBe('');
    vi.stubEnv('NEXT_PUBLIC_BASE_PATH', '');
    expect(getBasePath()).toBe('');
  });

  it('returns the configured path', () => {
    vi.stubEnv('NEXT_PUBLIC_BASE_PATH', '/designer');
    expect(getBasePath()).toBe('/designer');
  });
});

describe('withBasePath', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('prefixes a root-relative path', () => {
    vi.stubEnv('NEXT_PUBLIC_BASE_PATH', '/chefs');
    expect(withBasePath('/silent-check-sso.html')).toBe('/chefs/silent-check-sso.html');
  });

  it('leaves the path alone at the root', () => {
    vi.stubEnv('NEXT_PUBLIC_BASE_PATH', '');
    expect(withBasePath('/silent-check-sso.html')).toBe('/silent-check-sso.html');
  });
});
