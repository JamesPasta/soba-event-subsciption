import React, { act } from 'react';
import { render } from '@testing-library/react';
import { Provider } from 'react-redux';
import { SWRConfig } from 'swr';
import type makeStore from '@/lib/store';
import { initKeycloak } from '@/lib/slices/keycloakSlice';

type Store = ReturnType<typeof makeStore>;

// Each callback returns a promise, which keeps act on its async path.
export async function renderInStore(store: Store, ui: React.ReactElement) {
  await act(() => {
    render(
      <Provider store={store}>
        <SWRConfig
          value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}
        >
          {ui}
        </SWRConfig>
      </Provider>,
    );
    return Promise.resolve();
  });
}

// Keycloak never runs in tests, so the init lifecycle is driven directly.
export async function answerInit(
  store: Store,
  payload: { authenticated: boolean; token?: string },
) {
  await act(() => {
    store.dispatch({ type: initKeycloak.pending.type });
    return Promise.resolve();
  });
  await act(() => {
    store.dispatch({ type: initKeycloak.fulfilled.type, payload });
    return Promise.resolve();
  });
}
