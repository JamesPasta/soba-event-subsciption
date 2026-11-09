import React, { act } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { kc, search, me } = vi.hoisted(() => ({
  kc: { authenticated: true, initializing: false, initStarted: true },
  search: { value: '' },
  me: { idpCode: 'idir' as string | null, loaded: true, hasError: false },
}));

vi.mock('@/src/shared/api/useCurrentUser', () => ({
  useCurrentUser: () => ({
    data: me.loaded ? { profile: { idpCode: me.idpCode } } : null,
    loaded: me.loaded,
    hasError: me.hasError,
  }),
}));

vi.mock('@/lib/hooks/useKeycloak', () => ({
  useKeycloak: () => ({ ...kc, token: 'token' }),
}));

vi.mock('@/app/[lang]/Providers', () => ({
  useDictionary: () => ({
    locale: 'en',
    general: {
      notAuthenticated: 'Not authed',
      sessionExpired: 'Your session has ended.',
      noAccess: 'No access.',
      loading: 'Loading…',
      search: 'Search',
      cancel: 'Cancel',
      clearFilters: 'Reset Filters',
      lookupTruncated: 'Showing the first {limit}.',
      myForms: 'My Forms',
    },
    workspaces: { workspace: 'Workspace', allWorkspaces: 'All Workspaces' },
    myForms: {
      columns: { form: 'Form', workspace: 'Workspace', actions: 'Actions' },
      start: 'Start',
      startLabel: 'Start a new submission for {form}',
      notOpen: "You can't start a new submission",
      empty: 'You have no forms yet.',
      noMatches: 'No forms match your search or filter.',
      loadError: 'Could not load your forms.',
      workspacesLoadError: 'Could not load your workspaces.',
      selectedWorkspace: 'Selected workspace',
      itemName: 'forms',
    },
    dataTable: { itemName: 'items', pageOf: 'of {totalPages} page(s)' },
  }),
}));

const mockPush = vi.fn();
vi.mock('next/navigation', async () => {
  const actual = await vi.importActual<unknown>('next/navigation');
  return {
    ...(actual as Record<string, unknown>),
    useRouter: () => ({ push: mockPush }),
    usePathname: () => '/en/my-forms',
    useSearchParams: () => new URLSearchParams(search.value),
  };
});

const getMyForms = vi.fn();
const getMyWorkspaces = vi.fn();
vi.mock('@/src/shared/api/sobaApi', () => ({
  getMyForms: (...args: unknown[]) => getMyForms(...args),
  getMyWorkspaces: (...args: unknown[]) => getMyWorkspaces(...args),
}));

const addNotification = vi.fn();
vi.mock('@/lib/hooks/useNotificationStore', () => ({
  useNotificationStore: () => ({ addNotification }),
}));

import { Provider } from 'react-redux';
import { SWRConfig } from 'swr';
import makeStore from '@/lib/store';
import { setAuthenticated, setToken } from '@/lib/slices/keycloakSlice';
import { MyFormsList } from '@/src/features/submit-mode/ui/MyFormsList';

const WS_A = { id: '0199a0f8-0625-701d-a41e-648bc7ae9c71', name: 'Licensing' };
const WS_B = { id: '0199a0f8-0625-701d-a41e-648bc7ae9c72', name: 'Grants' };

// The caller holds the submitter role on it.
const OPEN = {
  id: 'f1',
  name: 'Permit application',
  workspaceId: WS_A.id,
  workspaceName: WS_A.name,
  publishedVersionId: 'v1',
  permissions: ['document_template_read', 'submission_create'],
  audienceMode: 'members' as const,
  audienceIdps: [],
  allowSubmitterDrafts: true,
  allowSubmitterRevision: false,
};
// Listed for the caller's earlier submission; nothing open to start.
const HISTORY = {
  id: 'f2',
  name: 'Grant report',
  workspaceId: WS_B.id,
  workspaceName: WS_B.name,
  publishedVersionId: null,
  permissions: [],
  audienceMode: 'public' as const,
  audienceIdps: [],
  allowSubmitterDrafts: false,
  allowSubmitterRevision: false,
};

const page = (items: unknown[]) => ({
  items,
  page: { offset: 0, limit: 10, total: items.length },
  filters: {},
  sort: 'name:asc',
});
const lookup = (items: unknown[], truncated = false) => ({ items, limit: 500, truncated });

let store: ReturnType<typeof makeStore>;
let replaceState: ReturnType<typeof vi.spyOn>;

const NO_RETRY = { shouldRetryOnError: false };
let swrRetry: Record<string, unknown> = NO_RETRY;

function listTree() {
  return (
    <Provider store={store}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, ...swrRetry }}>
        <MyFormsList />
      </SWRConfig>
    </Provider>
  );
}

async function renderList() {
  let view: ReturnType<typeof render> | undefined;
  await act(async () => {
    view = render(listTree());
  });
  return view!;
}

/** Next keeps useSearchParams in sync with replaceState; the mock does not, so the test does. */
async function syncUrl(view: ReturnType<typeof render>) {
  const url = replaceState.mock.calls.at(-1)?.[2];
  search.value = typeof url === 'string' ? (url.split('?')[1] ?? '') : '';
  await act(async () => {
    view.rerender(listTree());
  });
}

const lastRequest = () => getMyForms.mock.calls.at(-1)?.[1];
// The hidden native select carries a blank placeholder ahead of the real options.
const optionLabels = (picker: HTMLSelectElement) =>
  [...picker.options].filter((option) => option.value !== '').map((option) => option.textContent);
const lastUrl = () => String(replaceState.mock.calls.at(-1)?.[2]);

describe('MyFormsList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    search.value = '';
    me.idpCode = 'idir';
    me.loaded = true;
    me.hasError = false;
    kc.authenticated = true;
    kc.initializing = false;
    store = makeStore();
    store.dispatch(setToken('token'));
    store.dispatch(setAuthenticated(true));
    getMyForms.mockResolvedValue(page([OPEN, HISTORY]));
    getMyWorkspaces.mockResolvedValue(lookup([WS_B, WS_A]));
    replaceState = vi.spyOn(window.history, 'replaceState');
    swrRetry = NO_RETRY;
  });

  afterEach(() => {
    replaceState.mockRestore();
  });

  it('reads by name, across every workspace', async () => {
    await renderList();
    expect(lastRequest()).toMatchObject({ offset: 0, limit: 10, sort: 'name:asc' });
    expect(lastRequest().workspaceId).toBeUndefined();
  });

  it('shows the form name as text and its workspace', async () => {
    await renderList();
    expect(await screen.findByTestId('my-form-name-f1')).toHaveTextContent('Permit application');
    expect(within(screen.getByTestId('my-form-name-f1')).queryByRole('button')).toBeNull();
    expect(screen.getByTestId('f1-workspace')).toHaveTextContent('Licensing');
  });

  it('starts a new submission on a form that is open to the caller', async () => {
    await renderList();
    const start = await screen.findByTestId('f1-start');
    expect(start).toHaveAccessibleName('Start a new submission for Permit application');
    await userEvent.click(start);
    expect(mockPush).toHaveBeenCalledWith('/en/form/f1');
  });

  it.each([
    ['admits', 'idir', true],
    ['refuses', 'bceidbusiness', false],
  ])("starts by audience where it %s the caller's provider", async (_label, idpCode, starts) => {
    me.idpCode = idpCode;
    getMyForms.mockResolvedValue(
      page([
        { ...HISTORY, publishedVersionId: 'v2', audienceMode: 'protected', audienceIdps: ['idir'] },
      ]),
    );
    await renderList();
    await screen.findByTestId('my-form-name-f2');
    expect(!!screen.queryByTestId('f2-start')).toBe(starts);
  });

  it("waits for the caller's provider before showing what they can start", async () => {
    me.loaded = false;
    await renderList();
    expect(screen.getByTestId('datatable-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('f1-start')).not.toBeInTheDocument();
  });

  it('starts by role, never by a protected audience, when the provider cannot be read', async () => {
    me.loaded = false;
    me.hasError = true;
    getMyForms.mockResolvedValue(
      page([
        OPEN,
        { ...HISTORY, publishedVersionId: 'v2', audienceMode: 'protected', audienceIdps: ['idir'] },
      ]),
    );
    await renderList();
    expect(await screen.findByTestId('f1-start')).toBeInTheDocument();
    expect(screen.queryByTestId('f2-start')).not.toBeInTheDocument();
  });

  it('offers no start on a form that is not open to the caller', async () => {
    await renderList();
    expect(await screen.findByTestId('f2-not-open')).toHaveTextContent(
      "You can't start a new submission",
    );
    expect(screen.queryByTestId('f2-start')).not.toBeInTheDocument();
  });

  it("offers the caller's workspaces in the filter", async () => {
    await renderList();
    const picker = screen.getByTestId('my-forms-workspace-select').querySelector('select')!;
    await waitFor(() =>
      expect(optionLabels(picker)).toEqual(['All Workspaces', 'Grants', 'Licensing']),
    );
  });

  it('notes when the workspace options stop at the limit', async () => {
    getMyWorkspaces.mockResolvedValue(lookup([WS_A], true));
    await renderList();
    expect(await screen.findByText('Showing the first 500.')).toBeInTheDocument();
  });

  it('reads again when the workspace filter changes', async () => {
    const view = await renderList();
    await screen.findByTestId('f1-start');

    const picker = screen.getByTestId('my-forms-workspace-select').querySelector('select')!;
    await waitFor(() => expect(optionLabels(picker)).toHaveLength(3));
    await act(async () => {
      fireEvent.change(picker, { target: { value: WS_A.id } });
    });
    await waitFor(() => expect(lastUrl()).toContain(`myForms.workspace=${WS_A.id}`));

    await syncUrl(view);
    await waitFor(() => expect(lastRequest().workspaceId).toBe(WS_A.id));
  });

  it('reads the workspace filter from the URL once the options name it', async () => {
    search.value = `myForms.workspace=${WS_B.id}`;
    await renderList();
    await waitFor(() => expect(lastRequest()?.workspaceId).toBe(WS_B.id));
    expect(getMyForms.mock.calls.every(([, args]) => args.workspaceId === WS_B.id)).toBe(true);
  });

  it.each([
    ['a workspace that is not one of the options', '0199a0f8-0625-701d-a41e-648bc7ae9c79'],
    ['a value that is not a workspace id', 'mine'],
  ])('drops %s from the URL and never sends it', async (_label, value) => {
    search.value = `myForms.workspace=${value}`;
    await renderList();
    await waitFor(() => expect(replaceState).toHaveBeenCalled());
    expect(lastUrl()).not.toContain('myForms.workspace');
    expect(getMyForms).toHaveBeenCalled();
    expect(getMyForms.mock.calls.every(([, args]) => args.workspaceId === undefined)).toBe(true);
  });

  it('reports options that fail to load and still filters by the id in the URL', async () => {
    const failure = new Error('boom');
    getMyWorkspaces.mockRejectedValue(failure);
    getMyForms.mockResolvedValue(page([OPEN]));
    search.value = `myForms.workspace=${WS_A.id}`;
    await renderList();
    await waitFor(() =>
      expect(addNotification).toHaveBeenCalledWith({
        text: 'Could not load your workspaces.',
        type: 'error',
        consoleError: failure,
      }),
    );
    await waitFor(() => expect(getMyForms).toHaveBeenCalled());
    expect(getMyForms.mock.calls.every(([, args]) => args.workspaceId === WS_A.id)).toBe(true);
    // The filter stays in the URL for when the options load.
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('reports a standing failure once, however often it is retried', async () => {
    swrRetry = { shouldRetryOnError: true, errorRetryCount: 2, errorRetryInterval: 5 };
    // A new error per attempt, as a real failed request gives.
    getMyWorkspaces.mockImplementation(() => Promise.reject(new Error('boom')));
    await renderList();
    await waitFor(() => expect(getMyWorkspaces).toHaveBeenCalledTimes(3), { timeout: 2000 });
    const reports = addNotification.mock.calls.filter(
      ([notice]) => notice.text === 'Could not load your workspaces.',
    );
    expect(reports).toHaveLength(1);
  });

  it('filters by an id the options stopped short of, named from its rows', async () => {
    const beyond = { ...OPEN, id: 'f9', workspaceId: '0199a0f8-0625-701d-a41e-648bc7ae9c79' };
    getMyWorkspaces.mockResolvedValue(lookup([WS_A], true));
    getMyForms.mockResolvedValue(page([{ ...beyond, workspaceName: 'Far away' }]));
    search.value = `myForms.workspace=${beyond.workspaceId}`;
    await renderList();
    await waitFor(() => expect(lastRequest()?.workspaceId).toBe(beyond.workspaceId));
    const picker = screen.getByTestId('my-forms-workspace-select').querySelector('select')!;
    await waitFor(() => expect(picker.value).toBe(beyond.workspaceId));
    expect(optionLabels(picker)).toContain('Far away');
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('resets the filter and the search together', async () => {
    search.value = `myForms.workspace=${WS_A.id}&myForms.q=permit`;
    await renderList();
    await userEvent.click(screen.getByTestId('my-forms-clear-filters'));
    await waitFor(() => expect(replaceState).toHaveBeenCalled());
    expect(lastUrl()).not.toContain('myForms.workspace');
    expect(lastUrl()).not.toContain('myForms.q');
  });

  it('says there is nothing yet when the unfiltered list is empty', async () => {
    getMyForms.mockResolvedValue(page([]));
    await renderList();
    expect(await screen.findByTestId('datatable-empty')).toHaveTextContent(
      'You have no forms yet.',
    );
  });

  it('says nothing matched when a search is applied', async () => {
    getMyForms.mockResolvedValue(page([]));
    search.value = 'myForms.q=tax';
    await renderList();
    expect(await screen.findByTestId('datatable-empty')).toHaveTextContent(
      'No forms match your search or filter.',
    );
  });

  it('asks a signed-out visitor to sign in', async () => {
    kc.authenticated = false;
    await renderList();
    expect(screen.getByText('Not authed')).toBeInTheDocument();
    expect(within(document.body).queryByRole('table')).not.toBeInTheDocument();
  });
});
