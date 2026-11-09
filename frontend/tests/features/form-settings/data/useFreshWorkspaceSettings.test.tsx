import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { SWRConfig } from 'swr';
import type { Audience } from '@/src/types/formSettings';

const { mockGetSettings } = vi.hoisted(() => ({ mockGetSettings: vi.fn() }));

vi.mock('@/src/features/form-settings/data/api', () => ({
  getWorkspaceSettings: mockGetSettings,
}));

import makeStore from '@/lib/store';
import { setAuthenticated, setToken } from '@/lib/slices/keycloakSlice';
import {
  useFreshWorkspaceSettings,
  useWorkspaceSettings,
} from '@/src/features/form-settings/data/useWorkspaceSettings';

function CachedRead() {
  const { settings } = useWorkspaceSettings<Audience>('audience', 'ws1');
  return <span data-testid="cached">{settings?.values.mode ?? 'loading'}</span>;
}

function FreshRead() {
  const { settings } = useFreshWorkspaceSettings<Audience>('audience', 'ws1');
  return <span data-testid="fresh">{settings?.values.mode ?? 'loading'}</span>;
}

// A fresh read that mounts and unmounts beside an optional shared read of the same workspace.
function Reads({ cached }: Readonly<{ cached: boolean }>) {
  const [freshShown, setFreshShown] = React.useState(false);
  return (
    <>
      {cached && <CachedRead />}
      <button type="button" onClick={() => setFreshShown((shown) => !shown)}>
        toggle fresh
      </button>
      {freshShown && <FreshRead />}
    </>
  );
}

describe('useFreshWorkspaceSettings', () => {
  let store: ReturnType<typeof makeStore>;

  const renderReads = (cached: boolean) =>
    render(
      <Provider store={store}>
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
          <Reads cached={cached} />
        </SWRConfig>
      </Provider>,
    );

  beforeEach(() => {
    vi.clearAllMocks();
    store = makeStore();
    store.dispatch(setToken('token'));
    store.dispatch(setAuthenticated(true));
    mockGetSettings
      .mockResolvedValueOnce({ values: { mode: 'members', idps: [] }, version: 1 })
      .mockResolvedValue({ values: { mode: 'public', idps: [] }, version: 2 });
  });

  it('reads the workspace again rather than using the shared read', async () => {
    const user = userEvent.setup();
    renderReads(true);
    expect(await screen.findByText('members')).toBeInTheDocument();

    await user.click(screen.getByText('toggle fresh'));

    expect(await screen.findByText('public')).toBeInTheDocument();
    expect(screen.getByTestId('cached')).toHaveTextContent('members');
    expect(mockGetSettings).toHaveBeenCalledTimes(2);
  });

  it('reads again each time it mounts', async () => {
    const user = userEvent.setup();
    renderReads(false);
    await user.click(screen.getByText('toggle fresh'));
    expect(await screen.findByText('members')).toBeInTheDocument();

    await user.click(screen.getByText('toggle fresh'));
    await user.click(screen.getByText('toggle fresh'));

    expect(await screen.findByText('public')).toBeInTheDocument();
    expect(mockGetSettings).toHaveBeenCalledTimes(2);
  });
});
