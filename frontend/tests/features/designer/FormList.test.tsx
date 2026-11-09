import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { act } from 'react';
import { Provider } from 'react-redux';
import { SWRConfig } from 'swr';

vi.mock('@/app/[lang]/Providers', () => ({
  useDictionary: () => ({
    locale: 'en',
    general: {
      notAuthenticated: 'Not authed',
      forms: 'Forms',
      loading: 'Loading...',
      sessionExpired: 'Your session has ended.',
      noAccess: 'You do not have access to this.',
      create: 'Create',
      search: 'Search',
      lookupTruncated: 'Showing the first {limit}.',
    },
    form: {
      nameLabel: 'Form Name',
      disclaimerRequired: 'Accept the workspace disclaimer before creating a form.',
      loadFormsError: 'Failed to load forms.',
    },
    header: {
      selectWorkspace: 'Select Workspace',
    },
    dataTable: {
      loadingMessage: 'Loading...',
      pageOf: 'of {totalPages} page(s)',
    },
    workspaces: {
      workspace: 'Workspace',
      allWorkspaces: 'All Workspaces',
      unavailableFilter: 'That workspace is not available to you.',
      clearFilter: 'Clear filter',
    },
    submission: {
      formList: {
        columns: {
          name: 'Name',
          actions: 'Actions',
          createdBy: 'Created By',
          createdAt: 'Created Date',
        },
      },
    },
  }),
}));

const mockPush = vi.fn();
const { search } = vi.hoisted(() => ({ search: { value: '' } }));
vi.mock('next/navigation', async () => {
  const actual = await vi.importActual<unknown>('next/navigation');
  return {
    ...(actual as Record<string, unknown>),
    useRouter: () => ({ push: mockPush }),
    usePathname: () => '/en/forms',
    useSearchParams: () => new URLSearchParams(search.value),
  };
});

const getSobaForms = vi.fn();
const lookupWorkspaces = vi.fn();
const selectWorkspace = vi.fn();
const fetchCurrentUser = vi.fn();
vi.mock('@/src/shared/api/sobaApi', () => ({
  getSobaForms: (...args: unknown[]) => getSobaForms(...args),
  lookupWorkspaces: (...args: unknown[]) => lookupWorkspaces(...args),
  selectWorkspace: (...args: unknown[]) => selectWorkspace(...args),
  fetchCurrentUser: (...args: unknown[]) => fetchCurrentUser(...args),
}));

import makeStore from '@/lib/store';
import { setAuthenticated, setToken } from '@/lib/slices/keycloakSlice';
import FormList from '@/src/features/designer/ui/FormList';
import { PageLayout } from '@/src/components/PageLayout';
import { ApiError } from '@/src/shared/api/sobaHelpers';

type TestWorkspace = { id: string; name?: string; kind?: string };

const WS1 = '00000000-0000-4000-8000-000000000001';
const WS2 = '00000000-0000-4000-8000-000000000002';
const WS9 = '00000000-0000-4000-8000-000000000009';
const WS_UNKNOWN = '00000000-0000-4000-8000-0000000000aa';
const WS_GONE = '00000000-0000-4000-8000-0000000000bb';

type SeedOptions = {
  formCreate?: 'allowed' | 'disclaimer_required' | 'none';
  truncated?: boolean;
  /** Workspaces a direct read resolves. Defaults to the options. */
  readable?: TestWorkspace[];
};

let store: ReturnType<typeof makeStore>;

function seed(workspaces: TestWorkspace[], options: SeedOptions = {}) {
  store.dispatch(setToken('token'));
  store.dispatch(setAuthenticated(true));
  lookupWorkspaces.mockResolvedValue({
    items: workspaces,
    limit: 500,
    truncated: options.truncated ?? false,
  });
  const readable = options.readable ?? workspaces;
  selectWorkspace.mockImplementation((_token: string, id: string) => {
    const found = readable.find((w) => w.id === id);
    return found ? Promise.resolve(found) : Promise.reject(new ApiError('Forbidden', 403));
  });
  fetchCurrentUser.mockResolvedValue({
    capabilities: {
      canCreateWorkspace: false,
      hasWorkspaces: true,
      formCreate: options.formCreate ?? 'allowed',
      isSobaAdmin: false,
    },
  });
}

async function renderList() {
  let view: ReturnType<typeof render> | undefined;
  await act(async () => {
    view = render(
      <Provider store={store}>
        <SWRConfig
          value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}
        >
          <PageLayout headingId="forms-heading" heading="Forms">
            <FormList />
          </PageLayout>
        </SWRConfig>
      </Provider>,
    );
  });
  return view!;
}

/** The workspace the last forms request was scoped to, `undefined` for an unscoped read. */
const scopedTo = (workspaceId?: string) =>
  getSobaForms.mock.calls.some((call) => call[1]?.workspaceId === workspaceId);

const lastFormsQuery = () => getSobaForms.mock.calls.at(-1)?.[1];

/**
 * Next keeps useSearchParams in sync with the component's replaceState; the mock does not, so a
 * change made on screen has to be fed back before the next render sees it.
 */
async function syncUrl(view: ReturnType<typeof render>) {
  const url = (window.history.replaceState as ReturnType<typeof vi.spyOn>).mock.calls.at(-1)?.[2];
  search.value = typeof url === 'string' ? (url.split('?')[1] ?? '') : '';
  await act(async () => {
    view.rerender(listTree());
  });
}

function listTree() {
  return (
    <Provider store={store}>
      <SWRConfig
        value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}
      >
        <PageLayout headingId="forms-heading" heading="Forms">
          <FormList />
        </PageLayout>
      </SWRConfig>
    </Provider>
  );
}

describe('FormList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    search.value = '';
    store = makeStore();
    getSobaForms.mockResolvedValue({
      items: [
        {
          id: 'f1',
          workspaceId: WS1,
          workspaceName: 'Alpha',
          name: 'Form One',
          status: 'active',
          createdBy: 'alice',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'f2',
          workspaceId: WS2,
          workspaceName: 'Beta',
          name: 'Form Two',
          status: 'active',
          createdBy: 'bob',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      page: { offset: 0, limit: 10, total: 2 },
    });
  });

  it('warns and disables Create when no creatable workspace has an accepted disclaimer', async () => {
    seed([{ id: WS1 }], { formCreate: 'disclaimer_required' });
    await renderList();
    expect(await screen.findByTestId('page-notice-disclaimer')).toBeInTheDocument();
    expect(screen.getByTestId('create-form-button')).toBeDisabled();
  });

  it('allows Create when the user can create a form in some workspace', async () => {
    seed([{ id: WS1 }, { id: WS2 }]);
    await renderList();
    await waitFor(() => expect(screen.getByTestId('create-form-button')).not.toBeDisabled());
    expect(screen.queryByTestId('page-notice-disclaimer')).not.toBeInTheDocument();
  });

  // The picker scopes the list, not the new form's workspace, so it must not gate Create.
  it('keeps Create enabled while the list is filtered to a workspace', async () => {
    search.value = `forms.workspace=${WS1}`;
    seed([{ id: WS1 }, { id: WS2 }]);
    await renderList();
    await waitFor(() => expect(screen.getByTestId('create-form-button')).not.toBeDisabled());
    expect(screen.queryByTestId('page-notice-disclaimer')).not.toBeInTheDocument();
  });

  // Read-only membership is not a creation target, so it must not enable Create either.
  it('disables Create when the user has no workspace they can create in', async () => {
    seed([{ id: WS1 }], { formCreate: 'none' });
    await renderList();
    await waitFor(() => expect(fetchCurrentUser).toHaveBeenCalled());
    expect(screen.queryByTestId('page-notice-disclaimer')).not.toBeInTheDocument();
    expect(screen.getByTestId('create-form-button')).toBeDisabled();
  });

  it('opens the form in the designer from the row and its quick links', async () => {
    seed([{ id: WS1 }]);
    await renderList();
    await waitFor(() => expect(screen.getByText('Form One')).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByTestId('form-link-f1'));
      fireEvent.click(screen.getByTestId('submit-f1-button'));
      fireEvent.click(screen.getByTestId('submissions-f1-button'));
    });

    expect(mockPush.mock.calls).toEqual([
      ['/en/build/f1'],
      ['/en/build/f1?tab=share'],
      ['/en/build/f1?tab=submissions'],
    ]);
  });

  it('renders the search input', async () => {
    seed([{ id: WS1 }]);
    await renderList();
    const input = screen
      .getByTestId('search-forms-text')
      .querySelector('input') as HTMLInputElement;
    expect(input).toBeInTheDocument();
  });

  it('loads and displays rows from API', async () => {
    seed([{ id: WS1 }]);
    await renderList();
    await waitFor(() => expect(screen.getByText('Form One')).toBeInTheDocument());
    expect(screen.getByText('Form Two')).toBeInTheDocument();
  });

  // Searching only the fetched page would hide every match past it, so the term goes to the server.
  it('sends the search term to the server when the search is submitted', async () => {
    seed([{ id: WS1 }]);
    const view = await renderList();
    await waitFor(() => expect(screen.getByText('Form One')).toBeInTheDocument());
    const input = screen
      .getByTestId('search-forms-text')
      .querySelector('input') as HTMLInputElement;

    const replaceState = vi.spyOn(window.history, 'replaceState');
    await act(async () => {
      fireEvent.change(input, { target: { value: 'two' } });
    });
    expect(replaceState).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByTestId('search-forms-button'));
    });
    await waitFor(() => expect(replaceState).toHaveBeenCalled());
    await syncUrl(view);

    await waitFor(() => expect(lastFormsQuery()?.q).toBe('two'));
    replaceState.mockRestore();
  });

  it('asks for the page and page size the URL names', async () => {
    search.value = 'forms.page=3&forms.pageSize=25';
    seed([{ id: WS1 }]);
    await renderList();
    await waitFor(() => expect(lastFormsQuery()).toMatchObject({ offset: 50, limit: 25 }));
  });

  // A remembered or hand-edited size the API would reject leaves a dead table, so it never ships.
  it('falls back to a valid page size when the URL names one that is not offered', async () => {
    search.value = 'forms.pageSize=999';
    seed([{ id: WS1 }]);
    await renderList();
    await waitFor(() => expect(lastFormsQuery()).toMatchObject({ limit: 10 }));
  });

  it('sorts on the server when a header is clicked', async () => {
    seed([{ id: WS1 }]);
    const view = await renderList();
    await waitFor(() => expect(screen.getByText('Form One')).toBeInTheDocument());

    const replaceState = vi.spyOn(window.history, 'replaceState');
    await act(async () => {
      fireEvent.click(screen.getByTestId('datatable-sort-name'));
    });
    await syncUrl(view);

    await waitFor(() => expect(lastFormsQuery()?.sort).toBe('name:asc'));
    replaceState.mockRestore();
  });

  it('scopes the request to the workspace named in the URL', async () => {
    search.value = `forms.workspace=${WS2}`;
    seed([{ id: WS1 }, { id: WS2 }]);
    await renderList();
    await waitFor(() => expect(scopedTo(WS2)).toBe(true));
  });

  // A URL can name a workspace this user cannot see. Reading unscoped would leak another
  // workspace's rows under that filter, so the id has to be resolved before it is sent.
  it('ignores a workspace in the URL that the user cannot see, and says so', async () => {
    search.value = `forms.workspace=${WS_UNKNOWN}`;
    seed([{ id: WS1 }]);
    await renderList();
    await waitFor(() => expect(scopedTo(undefined)).toBe(true));
    expect(screen.getByTestId('page-notice-workspace-filter')).toBeInTheDocument();
  });

  // The nav link back to the list is a bare href, so the filter has to be remembered per tab or
  // it is lost every time the user leaves the page.
  it('restores the last filter on a nav arrival, and scopes the first request', async () => {
    search.value = 'from=nav';
    sessionStorage.setItem('soba.listQuery.forms', JSON.stringify({ workspace: WS2 }));
    seed([{ id: WS1 }, { id: WS2 }]);
    await renderList();
    await waitFor(() => expect(scopedTo(WS2)).toBe(true));
    // The unscoped read must never happen, or another workspace's rows land on screen first.
    expect(scopedTo(undefined)).toBe(false);
  });

  it('does not restore a filter the user cleared', async () => {
    search.value = 'from=nav';
    sessionStorage.setItem('soba.listQuery.forms', JSON.stringify({}));
    seed([{ id: WS1 }, { id: WS2 }]);
    await renderList();
    await waitFor(() => expect(scopedTo(undefined)).toBe(true));
  });

  // Clearing removes the param, which looks exactly like a fresh arrival. Restoring more than once
  // puts the filter straight back and the picker cannot be set to All Workspaces.
  it('lets the user clear a restored filter', async () => {
    search.value = 'from=nav';
    sessionStorage.setItem('soba.listQuery.forms', JSON.stringify({ workspace: WS2 }));
    seed([{ id: WS1 }, { id: WS2 }]);
    const view = await renderList();
    await waitFor(() => expect(scopedTo(WS2)).toBe(true));

    const picker = screen.getByTestId('workspace-select').querySelector('select')!;
    await act(async () => {
      fireEvent.change(picker, { target: { value: 'all' } });
    });
    // Next syncs useSearchParams with the replaceState the component just made; the mock does not,
    // so the test does it.
    search.value = '';
    await act(async () => {
      view.rerender(listTree());
    });

    await waitFor(() => expect(scopedTo(undefined)).toBe(true));
    expect(sessionStorage.getItem('soba.listQuery.forms')).toBe(JSON.stringify({}));
  });

  // A bare URL is a bookmark or someone else's link. Restoring there would show them a filtered
  // table they did not ask for.
  it('does not restore on a bare URL with no nav marker', async () => {
    sessionStorage.setItem('soba.listQuery.forms', JSON.stringify({ workspace: WS2 }));
    seed([{ id: WS1 }, { id: WS2 }]);
    await renderList();
    await waitFor(() => expect(scopedTo(undefined)).toBe(true));
    expect(scopedTo(WS2)).toBe(false);
    // Visiting a bare link is not a choice, so it must not erase the view set for this tab.
    expect(sessionStorage.getItem('soba.listQuery.forms')).toBe(JSON.stringify({ workspace: WS2 }));
  });

  it('remembers the filter the URL arrived with', async () => {
    search.value = `forms.workspace=${WS2}`;
    seed([{ id: WS1 }, { id: WS2 }]);
    await renderList();
    await waitFor(() =>
      expect(sessionStorage.getItem('soba.listQuery.forms')).toBe(
        JSON.stringify({ workspace: WS2 }),
      ),
    );
  });

  // Losing access to the workspace you had filtered to would otherwise raise the same notice on
  // every arrival from the nav, because the memory keeps handing the id back.
  it('forgets a filter it cannot resolve', async () => {
    search.value = `forms.workspace=${WS_GONE}`;
    sessionStorage.setItem('soba.listQuery.forms', JSON.stringify({ workspace: WS_GONE }));
    seed([{ id: WS1 }]);
    await renderList();

    expect(await screen.findByTestId('page-notice-workspace-filter')).toBeInTheDocument();
    await waitFor(() =>
      expect(sessionStorage.getItem('soba.listQuery.forms')).toBe(JSON.stringify({})),
    );
  });

  it('shows the workspace name each row carries', async () => {
    seed([{ id: WS1 }]);
    await renderList();
    await waitFor(() => expect(screen.getByTestId('workspace-tag-f1')).toHaveTextContent('Alpha'));
    expect(screen.getByTestId('workspace-tag-f2')).toHaveTextContent('Beta');
  });

  // The picker options stop at the lookup limit. A workspace past it is still one the user belongs
  // to, so the filter is resolved by reading that workspace, and it is kept in the picker.
  it('applies a URL filter for a workspace the options do not include', async () => {
    search.value = `forms.workspace=${WS9}`;
    seed([{ id: WS1, name: 'Alpha', kind: 'team' }], {
      truncated: true,
      readable: [
        { id: WS1, name: 'Alpha', kind: 'team' },
        { id: WS9, name: 'Far', kind: 'team' },
      ],
    });
    await renderList();
    await waitFor(() => expect(scopedTo(WS9)).toBe(true));
    expect(scopedTo(undefined)).toBe(false);
    expect(screen.queryByTestId('page-notice-workspace-filter')).not.toBeInTheDocument();
    expect(screen.getAllByText('Far (team)').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Showing the first 500.').length).toBeGreaterThan(0);
  });

  it('says nothing about the limit when every workspace was returned', async () => {
    seed([{ id: WS1, name: 'Alpha', kind: 'team' }]);
    await renderList();
    await waitFor(() => expect(lookupWorkspaces).toHaveBeenCalled());
    expect(screen.queryByText('Showing the first 500.')).not.toBeInTheDocument();
  });

  // A server error is not a refusal. Clearing the filter for one would drop a view the user can
  // still reach.
  it('reports a failed workspace read as a load error and keeps the filter', async () => {
    search.value = `forms.workspace=${WS9}`;
    seed([{ id: WS1 }]);
    selectWorkspace.mockRejectedValue(new ApiError('Request failed (500)', 500));
    await renderList();

    await waitFor(() => expect(screen.getByText(/Failed to load forms\./)).toBeInTheDocument());
    expect(screen.queryByTestId('page-notice-workspace-filter')).not.toBeInTheDocument();
    // The filter may still name one of the user's workspaces, so nothing is read unscoped.
    expect(getSobaForms).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('soba.listQuery.forms')).toBe(JSON.stringify({ workspace: WS9 }));
  });

  // A workspace the options already list needs no read of its own, so picking one does not wait.
  it('resolves a filter from the options without reading the workspace', async () => {
    search.value = `forms.workspace=${WS2}`;
    seed([{ id: WS1 }, { id: WS2 }]);
    await renderList();

    await waitFor(() => expect(scopedTo(WS2)).toBe(true));
    expect(selectWorkspace).not.toHaveBeenCalled();
  });

  it('ignores a filter that is not a workspace id without reading it', async () => {
    search.value = 'forms.workspace=not-a-workspace';
    seed([{ id: WS1 }]);
    await renderList();

    expect(await screen.findByTestId('page-notice-workspace-filter')).toBeInTheDocument();
    await waitFor(() => expect(scopedTo(undefined)).toBe(true));
    expect(selectWorkspace).not.toHaveBeenCalled();
  });

  it('treats a workspace that does not exist as not available', async () => {
    search.value = `forms.workspace=${WS_UNKNOWN}`;
    seed([{ id: WS1 }]);
    selectWorkspace.mockRejectedValue(new ApiError('Workspace not found', 404));
    await renderList();

    expect(await screen.findByTestId('page-notice-workspace-filter')).toBeInTheDocument();
    await waitFor(() => expect(scopedTo(undefined)).toBe(true));
  });

  it('clears a filter from the notice', async () => {
    search.value = `forms.workspace=${WS_UNKNOWN}`;
    seed([{ id: WS1 }]);
    const view = await renderList();
    const replaceState = vi.spyOn(window.history, 'replaceState');

    await act(async () => {
      fireEvent.click(await screen.findByTestId('page-notice-workspace-filter-action'));
    });
    await syncUrl(view);

    await waitFor(() =>
      expect(screen.queryByTestId('page-notice-workspace-filter')).not.toBeInTheDocument(),
    );
    expect(sessionStorage.getItem('soba.listQuery.forms')).toBe(JSON.stringify({}));
    replaceState.mockRestore();
  });

  // Until the options answer, a workspace in them cannot be told apart from one that needs a read.
  it('does not read the workspace or the forms before the options have loaded', async () => {
    search.value = `forms.workspace=${WS9}`;
    seed([{ id: WS1 }]);
    lookupWorkspaces.mockReturnValue(new Promise(() => {}));
    await renderList();

    expect(selectWorkspace).not.toHaveBeenCalled();
    expect(getSobaForms).not.toHaveBeenCalled();
  });

  it('reports an ended session instead of the raw error', async () => {
    const expired = new Error('Session expired');
    expired.name = 'SessionExpiredError';
    getSobaForms.mockRejectedValue(expired);
    seed([{ id: WS1 }]);
    await renderList();
    await waitFor(() => expect(screen.getByText(/Your session has ended\./)).toBeInTheDocument());
  });

  // The backend's string is untranslated and says things like "Request failed (500)".
  it('reports a failed load without showing the backend message', async () => {
    getSobaForms.mockRejectedValue(new Error('Request failed (500)'));
    seed([{ id: WS1 }]);
    await renderList();

    await waitFor(() => expect(screen.getByText(/Failed to load forms\./)).toBeInTheDocument());
    expect(screen.queryByText(/Request failed/)).not.toBeInTheDocument();
  });

  // Clicking the nav link while already on this page is a query-only navigation: the App Router
  // re-renders rather than remounting, so a mount-only restore never runs.
  it('restores on a nav arrival that does not remount', async () => {
    search.value = `forms.workspace=${WS2}`;
    seed([{ id: WS1 }, { id: WS2 }]);
    const view = await renderList();
    await waitFor(() => expect(scopedTo(WS2)).toBe(true));

    const replaceState = vi.spyOn(window.history, 'replaceState');
    search.value = 'from=nav';
    await act(async () => {
      view.rerender(listTree());
    });

    await waitFor(() => expect(lastFormsQuery()?.workspaceId).toBe(WS2));
    // The marker is consumed on arrival; leaving it in the URL would make a copied link restore
    // the reader's own view.
    expect(replaceState).toHaveBeenCalledWith(null, '', `/en/forms?forms.workspace=${WS2}`);
    replaceState.mockRestore();
  });
});
