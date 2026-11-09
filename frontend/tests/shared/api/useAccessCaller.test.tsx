import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const h = vi.hoisted(() => ({
  kc: { authenticated: false, initializing: false, initStarted: true },
  me: { data: null as null | { profile: { idpCode: string } }, loaded: false, hasError: false },
}));

vi.mock('@/lib/hooks/useKeycloak', () => ({ useKeycloak: () => h.kc }));
vi.mock('@/src/shared/api/useCurrentUser', () => ({ useCurrentUser: () => h.me }));

import { useAccessCaller } from '@/src/shared/api/useAccessCaller';

const run = () => renderHook(() => useAccessCaller()).result.current;

beforeEach(() => {
  h.kc = { authenticated: false, initializing: false, initStarted: true };
  h.me = { data: null, loaded: false, hasError: false };
});

describe('useAccessCaller', () => {
  it.each([
    ['before Keycloak starts', { initStarted: false }],
    ['while Keycloak initializes', { initializing: true }],
  ])('is pending %s', (_label, kc) => {
    h.kc = { ...h.kc, ...kc };
    expect(run().pending).toBe(true);
  });

  it('is the public caller when signed out', () => {
    expect(run()).toEqual({ caller: { idpCode: 'public' }, pending: false });
  });

  it('waits for /me when signed in, then carries its provider', () => {
    h.kc.authenticated = true;
    expect(run().pending).toBe(true);
    h.me = { data: { profile: { idpCode: 'idir' } }, loaded: true, hasError: false };
    expect(run()).toEqual({ caller: { idpCode: 'idir' }, pending: false });
  });

  it('gives no provider when /me fails, and stops waiting', () => {
    h.kc.authenticated = true;
    h.me = { data: null, loaded: false, hasError: true };
    expect(run()).toEqual({ caller: { idpCode: null }, pending: false });
  });
});
