import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

// The Keycloak instance is the external boundary; the store below is real.
const kc = {
  token: undefined as string | undefined,
  refreshToken: undefined as string | undefined,
  authenticated: false,
  idTokenParsed: {} as Record<string, unknown>,
  updateToken: vi.fn(),
  init: vi.fn().mockResolvedValue(true),
  login: vi.fn(),
};

// A function expression, not an arrow: the slice calls `new Keycloak(...)`.
vi.mock('keycloak-js', () => ({
  default: vi.fn(function () {
    return kc;
  }),
}));
vi.mock('@/src/shared/config/runtimeConfig', () => ({
  loadFrontendRuntimeConfig: vi.fn().mockResolvedValue({
    auth: { keycloak: { url: 'http://kc.test', realm: 'r', clientId: 'c' } },
  }),
  getSobaApiBaseUrl: () => 'http://api.test',
}));
vi.mock('@/src/features/formio-v5/disableFormioBrowserAuth', () => ({
  disableFormioBrowserAuth: vi.fn(),
}));

const { initKeycloak, login, refreshAccessToken, getKeycloakInstance } =
  await import('@/lib/slices/keycloakSlice');
const { default: makeStore } = await import('@/lib/store');

type Store = ReturnType<typeof makeStore>;

async function storeWithSession(): Promise<Store> {
  const store = makeStore();
  await store.dispatch(initKeycloak());
  return store;
}

// Drop any instance left by a previous test so initKeycloak builds a fresh one.
function dropKeycloakInstance(): void {
  if (getKeycloakInstance()) makeStore().dispatch({ type: 'keycloak/clear' });
}

describe('initKeycloak', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dropKeycloakInstance();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('points the silent check at the base path', async () => {
    vi.stubEnv('NEXT_PUBLIC_BASE_PATH', '/chefs');
    await makeStore().dispatch(initKeycloak());
    expect(kc.init).toHaveBeenCalledWith(
      expect.objectContaining({
        silentCheckSsoRedirectUri: `${window.location.origin}/chefs/silent-check-sso.html`,
      }),
    );
  });
});

describe('login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dropKeycloakInstance();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // After page-load init, keycloak-js refuses a second init, so every sign-in takes this redirect.
  it('returns to the base path after sign-in', async () => {
    vi.stubEnv('NEXT_PUBLIC_BASE_PATH', '/chefs');
    const store = await storeWithSession();
    kc.init.mockRejectedValueOnce(new Error("A 'Keycloak' instance can only be initialized once."));

    await store.dispatch(login());

    expect(kc.login).toHaveBeenCalledWith({ redirectUri: `${window.location.origin}/chefs` });
  });
});

describe('refreshAccessToken', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    kc.token = 'live-token';
    kc.refreshToken = 'refresh-token';
    kc.authenticated = true;
    kc.updateToken.mockReset();
    dropKeycloakInstance();
  });

  it('mirrors a real refresh into the store', async () => {
    const store = await storeWithSession();
    kc.updateToken.mockImplementation(async () => {
      kc.token = 'rotated';
      return true;
    });

    const outcome = await store.dispatch(refreshAccessToken(false));

    expect(outcome).toEqual({ status: 'token', token: 'rotated' });
    expect(store.getState().keycloak.token).toBe('rotated');
  });

  it('leaves the store alone when no refresh was needed', async () => {
    const store = await storeWithSession();
    kc.updateToken.mockResolvedValue(false);

    const outcome = await store.dispatch(refreshAccessToken(false));

    expect(outcome).toEqual({ status: 'token', token: 'live-token' });
    expect(store.getState().keycloak.token).toBe('live-token');
  });

  // The decision that signs a user out. keycloak-js drops its own token only when the refresh
  // token is rejected, so that — not `force` — is the verdict.
  it.each([
    ['a blip on the proactive path', false, true],
    ['a blip on the forced path', true, true],
  ])('keeps the session through %s', async (_label, force, stillAuthenticated) => {
    const store = await storeWithSession();
    kc.authenticated = stillAuthenticated;
    kc.updateToken.mockRejectedValue(new Error('network'));

    const outcome = await store.dispatch(refreshAccessToken(force));

    expect(outcome).toEqual({ status: 'token', token: 'live-token' });
    expect(store.getState().keycloak.authenticated).toBe(true);
  });

  it.each([
    ['the proactive path', false],
    ['the forced path', true],
  ])('clears the session on a rejected refresh token via %s', async (_label, force) => {
    const store = await storeWithSession();
    kc.updateToken.mockImplementation(async () => {
      // What keycloak-js does on a 400 from the token endpoint.
      kc.token = undefined;
      kc.authenticated = false;
      throw new Error('rejected');
    });

    const outcome = await store.dispatch(refreshAccessToken(force));

    expect(outcome).toEqual({ status: 'no-session' });
    expect(store.getState().keycloak.authenticated).toBe(false);
  });

  // After clear() the instance is gone. That must read as "session over", not "no verdict" — the
  // latter makes sobaFetch send the caller's dead token, which the submit surface takes as anonymous.
  it('reports no-session once the session has been cleared', async () => {
    const store = await storeWithSession();
    kc.updateToken.mockImplementation(async () => {
      kc.token = undefined;
      kc.authenticated = false;
      throw new Error('rejected');
    });
    await store.dispatch(refreshAccessToken(true));

    // A later caller still holding a token from before the clear.
    const outcome = await store.dispatch(refreshAccessToken(false));

    expect(outcome).toEqual({ status: 'no-session' });
  });

  it('does not touch an anonymous instance that has no refresh token', async () => {
    kc.token = undefined;
    kc.refreshToken = undefined;
    kc.authenticated = false;
    const store = await storeWithSession();
    kc.updateToken.mockClear(); // init calls it once; we care about what the refresh does

    const outcome = await store.dispatch(refreshAccessToken(false));

    expect(kc.updateToken).not.toHaveBeenCalled();
    expect(outcome).toEqual({ status: 'unavailable' });
  });
});
