import React, { act } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { kc, search, access } = vi.hoisted(() => ({
  kc: { authenticated: true, initializing: false },
  search: { value: '' },
  access: { caller: { idpCode: 'idir' as string | null }, pending: false },
}));

vi.mock('@/lib/hooks/useKeycloak', () => ({
  useKeycloak: () => ({ ...kc, token: 'token' }),
}));

vi.mock('@/src/shared/api/useAccessCaller', () => ({
  useAccessCaller: () => access,
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
      mySubmissions: 'My Submissions',
    },
    mySubmissions: {
      columns: {
        form: 'Form',
        status: 'Status',
        confirmationId: 'Confirmation ID',
        updatedAt: 'Last updated',
        actions: 'Actions',
      },
      states: { draft: 'Draft', submitted: 'Submitted', revising: 'Revision requested' },
      reviewStatuses: {
        submitted: 'Submitted',
        inReview: 'In review',
        completed: 'Completed',
        revisionRequested: 'Revision requested',
      },
      statusFilter: 'Status',
      allStates: 'All',
      continue: 'Continue',
      view: 'View',
      delete: 'Delete',
      continueLabel: 'Continue {form}, last updated {updated}',
      viewLabel: 'View {form}, last updated {updated}',
      deleteLabel: 'Delete draft of {form}, last updated {updated}',
      empty: 'You have no submissions yet.',
      noMatches: 'No submissions match your search or filter.',
      loadError: 'Could not load your submissions.',
      itemName: 'submissions',
      deleteTitle: 'Delete draft',
      deleteMessage: 'Your draft of {form}, last updated {updated}, will be deleted.',
      deleteSuccess: 'Draft deleted.',
      deleteError: 'Could not delete this draft.',
      revise: 'Revise',
      reviseLabel: 'Revise {form}, last updated {updated}',
      reviseTitle: 'Revise your submission',
      reviseMessage: 'Your submission of {form} will be reopened.',
      reviseSuccess: 'Your submission is open to revise.',
      reviseError: 'Could not open this submission to revise.',
      viewAll: 'View my submissions',
      noCode: 'No confirmation ID yet',
    },
    apiErrors: {
      delete_closed: 'Already submitted, so it stays.',
      delete_denied: 'Only its owner can delete it.',
      revise_closed: 'A reviewer has already taken it up.',
    },
    dataTable: { itemName: 'items', pageOf: 'of {totalPages} page(s)' },
    modal: { dialogActions: 'Dialog actions' },
  }),
}));

const mockPush = vi.fn();
vi.mock('next/navigation', async () => {
  const actual = await vi.importActual<unknown>('next/navigation');
  return {
    ...(actual as Record<string, unknown>),
    useRouter: () => ({ push: mockPush }),
    usePathname: () => '/en/my-submissions',
    useSearchParams: () => new URLSearchParams(search.value),
  };
});

const getMySubmissions = vi.fn();
const deleteSubmitSubmission = vi.fn();
const reviseSubmitSubmission = vi.fn();
vi.mock('@/src/shared/api/sobaApi', () => ({
  getMySubmissions: (...args: unknown[]) => getMySubmissions(...args),
  deleteSubmitSubmission: (...args: unknown[]) => deleteSubmitSubmission(...args),
  reviseSubmitSubmission: (...args: unknown[]) => reviseSubmitSubmission(...args),
}));

const addNotification = vi.fn();
vi.mock('@/lib/hooks/useNotificationStore', () => ({
  useNotificationStore: () => ({ addNotification }),
}));

import { Provider } from 'react-redux';
import { SWRConfig } from 'swr';
import makeStore from '@/lib/store';
import { setAuthenticated, setToken } from '@/lib/slices/keycloakSlice';
import { ApiError } from '@/src/shared/api/sobaHelpers';
import { SessionExpiredError } from '@/src/shared/api/sobaFetch';
import { MySubmissionsList } from '@/src/features/submit-mode/ui/MySubmissionsList';

const DRAFT = {
  id: 's1',
  formId: 'f1',
  formName: 'Permit application',
  workflowState: 'draft',
  role: 'owner',
  submittedAt: null,
  createdAt: '2026-09-01T18:00:00.000Z',
  updatedAt: '2026-09-02T18:30:00.000Z',
  confirmationCode: null,
  reviewStatus: null,
};
const SUBMITTED = {
  id: 's2',
  formId: 'f2',
  formName: 'Grant report',
  workflowState: 'submitted',
  role: 'owner',
  submittedAt: '2026-09-03T18:00:00.000Z',
  createdAt: '2026-09-01T18:00:00.000Z',
  updatedAt: '2026-09-03T18:00:00.000Z',
  confirmationCode: 'K7M2Q9XA',
  reviewStatus: 'submitted',
};
const IN_REVIEW = { ...SUBMITTED, id: 's4', reviewStatus: 'inReview' };
const REVISING = {
  ...SUBMITTED,
  id: 's5',
  workflowState: 'revising',
  reviewStatus: 'revisionRequested',
};
const SHARED_DRAFT = { ...DRAFT, id: 's3', role: 'collaborator' };

const DRAFT_UPDATED = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
}).format(new Date(DRAFT.updatedAt));

// An IDIR audience: the IDIR caller writes what they hold a grant on, through the audience.
const writableForm = (id: string) => ({
  id,
  name: 'Form ' + id,
  workspaceId: 'w1',
  workspaceName: 'Roads',
  publishedVersionId: 'v1',
  permissions: [],
  audienceMode: 'protected',
  audienceIdps: ['idir'],
  allowSubmitterDrafts: true,
  allowSubmitterRevision: false,
});
// Members only and no role: a grant still reads, but nothing writes.
const readOnlyForm = (id: string) => ({
  ...writableForm(id),
  audienceMode: 'members',
  audienceIdps: [],
});

const page = (items: unknown[], forms: unknown[] = [writableForm('f1'), writableForm('f2')]) => ({
  items,
  forms,
  page: { offset: 0, limit: 10, total: items.length },
  filters: {},
  sort: 'updatedAt:desc',
});

let store: ReturnType<typeof makeStore>;
let replaceState: ReturnType<typeof vi.spyOn>;

function listTree() {
  return (
    <Provider store={store}>
      <SWRConfig
        value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}
      >
        <MySubmissionsList />
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

const lastRequest = () => getMySubmissions.mock.calls.at(-1)?.[1];

/** Holds a delete open until the test settles it. */
function deferredDelete() {
  let settle!: () => void;
  deleteSubmitSubmission.mockReturnValue(
    new Promise<void>((resolve) => {
      settle = resolve;
    }),
  );
  return () => settle();
}

describe('MySubmissionsList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    search.value = '';
    kc.authenticated = true;
    kc.initializing = false;
    access.caller = { idpCode: 'idir' };
    access.pending = false;
    store = makeStore();
    store.dispatch(setToken('token'));
    store.dispatch(setAuthenticated(true));
    getMySubmissions.mockResolvedValue(page([DRAFT, SUBMITTED]));
    deleteSubmitSubmission.mockResolvedValue(undefined);
    replaceState = vi.spyOn(window.history, 'replaceState');
  });

  afterEach(() => {
    replaceState.mockRestore();
  });

  it('reads the latest activity first, with no state filter', async () => {
    await renderList();
    expect(lastRequest()).toMatchObject({ offset: 0, limit: 10, sort: 'updatedAt:desc' });
    expect(lastRequest().workflowState).toBeUndefined();
  });

  it('shows each state in words, and a code only once submitted', async () => {
    await renderList();
    expect(await screen.findByTestId('s1-status')).toHaveTextContent('Draft');
    expect(screen.getByTestId('s2-status')).toHaveTextContent('Submitted');
    expect(screen.getByTestId('s1-confirmation-id')).toHaveTextContent('No confirmation ID yet');
    expect(screen.getByTestId('s2-confirmation-id')).toHaveTextContent('K7M2Q9XA');
  });

  // A submitter is told where the review stands, never who it is assigned to.
  it('shows a submitted row by its review, in the words the submitter is told', async () => {
    getMySubmissions.mockResolvedValue(page([IN_REVIEW, REVISING]));
    await renderList();
    expect(await screen.findByTestId('s4-status')).toHaveTextContent('In review');
    expect(screen.getByTestId('s5-status')).toHaveTextContent('Revision requested');
    expect(screen.getByTestId('s5-confirmation-id')).toHaveTextContent('K7M2Q9XA');
  });

  it('continues a submission sent back to revise, which its owner cannot delete', async () => {
    getMySubmissions.mockResolvedValue(page([REVISING]));
    await renderList();
    await userEvent.click(await screen.findByTestId('s5-continue'));
    expect(mockPush).toHaveBeenCalledWith('/en/submit/s5');
    expect(screen.queryByTestId('s5-delete')).not.toBeInTheDocument();
  });

  // The same lib rule the server applies: the owner, the form's setting, nothing taken up yet.
  it('offers Revise only on an owned submission no reviewer has taken up', async () => {
    getMySubmissions.mockResolvedValue(
      page(
        [SUBMITTED, IN_REVIEW, { ...SUBMITTED, id: 's6', role: 'collaborator' }],
        [{ ...writableForm('f2'), allowSubmitterRevision: true }],
      ),
    );
    await renderList();
    expect(await screen.findByTestId('s2-revise')).toHaveAccessibleName(
      expect.stringMatching(/^Revise Grant report, last updated /),
    );
    expect(screen.queryByTestId('s4-revise')).not.toBeInTheDocument();
    expect(screen.queryByTestId('s6-revise')).not.toBeInTheDocument();
  });

  it("offers no Revise when the form's settings turn it off", async () => {
    await renderList();
    expect(await screen.findByTestId('s2-view')).toBeInTheDocument();
    expect(screen.queryByTestId('s2-revise')).not.toBeInTheDocument();
  });

  it('revises after confirmation and opens the fill page', async () => {
    getMySubmissions.mockResolvedValue(
      page([SUBMITTED], [{ ...writableForm('f2'), allowSubmitterRevision: true }]),
    );
    reviseSubmitSubmission.mockResolvedValue({ id: 's2', workflowState: 'revising' });
    await renderList();
    await userEvent.click(await screen.findByTestId('s2-revise'));
    await userEvent.click(await screen.findByTestId('confirm-modal-confirm'));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/en/submit/s2'));
    expect(reviseSubmitSubmission).toHaveBeenCalledWith('token', 's2', {
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    expect(addNotification).toHaveBeenCalledWith({
      text: 'Your submission is open to revise.',
      type: 'success',
    });
  });

  it('says why when a reviewer took it up first, and stays on the list', async () => {
    getMySubmissions.mockResolvedValue(
      page([SUBMITTED], [{ ...writableForm('f2'), allowSubmitterRevision: true }]),
    );
    reviseSubmitSubmission.mockRejectedValue(new ApiError('conflict', 409, 'revise_closed'));
    await renderList();
    await userEvent.click(await screen.findByTestId('s2-revise'));
    await userEvent.click(await screen.findByTestId('confirm-modal-confirm'));

    await waitFor(() =>
      expect(addNotification).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'A reviewer has already taken it up.' }),
      ),
    );
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('shows the time of the last update, so same-day rows differ', async () => {
    await renderList();
    expect(await screen.findByTestId('s1-updated-date')).toHaveTextContent(DRAFT_UPDATED);
  });

  it('names the row in each action, with its last update', async () => {
    await renderList();
    expect(await screen.findByTestId('s1-continue')).toHaveAccessibleName(
      `Continue Permit application, last updated ${DRAFT_UPDATED}`,
    );
    expect(screen.getByTestId('s1-delete')).toHaveAccessibleName(
      `Delete draft of Permit application, last updated ${DRAFT_UPDATED}`,
    );
    expect(screen.getByTestId('s2-view')).toHaveAccessibleName(
      expect.stringMatching(/^View Grant report, last updated /),
    );
  });

  it('keeps `$` in a form name literal', async () => {
    getMySubmissions.mockResolvedValue(page([{ ...DRAFT, formName: 'Fees $& $$ form' }]));
    await renderList();
    expect(await screen.findByTestId('s1-continue')).toHaveAccessibleName(
      `Continue Fees $& $$ form, last updated ${DRAFT_UPDATED}`,
    );
  });

  it('continues a draft in the fill page and views a submitted one read-only', async () => {
    await renderList();
    await userEvent.click(await screen.findByTestId('s1-continue'));
    expect(mockPush).toHaveBeenCalledWith('/en/submit/s1');
    await userEvent.click(screen.getByTestId('s2-view'));
    expect(mockPush).toHaveBeenCalledWith('/en/submission/s2');
    await userEvent.click(screen.getByTestId('my-submission-link-s2'));
    expect(mockPush).toHaveBeenLastCalledWith('/en/submission/s2');
  });

  it('offers delete on an owned draft only', async () => {
    getMySubmissions.mockResolvedValue(page([DRAFT, SUBMITTED, SHARED_DRAFT]));
    await renderList();
    expect(await screen.findByTestId('s1-delete')).toBeInTheDocument();
    expect(screen.queryByTestId('s1-view')).not.toBeInTheDocument();
    expect(screen.queryByTestId('s2-delete')).not.toBeInTheDocument();
    expect(screen.queryByTestId('s2-continue')).not.toBeInTheDocument();
    expect(screen.getByTestId('s3-continue')).toBeInTheDocument();
    expect(screen.queryByTestId('s3-delete')).not.toBeInTheDocument();
  });

  it('shows rows only once the caller is known', async () => {
    access.pending = true;
    const view = await renderList();
    await waitFor(() => expect(getMySubmissions).toHaveBeenCalled());
    // The response has landed; the rows still wait for the caller.
    await act(async () => undefined);
    expect(screen.getByTestId('datatable-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('s1-continue')).not.toBeInTheDocument();
    expect(screen.queryByTestId('s1-view')).not.toBeInTheDocument();
    access.pending = false;
    await act(async () => view.rerender(listTree()));
    expect(await screen.findByTestId('s1-continue')).toBeInTheDocument();
  });

  // A grant still reads the draft, but the form no longer admits the caller to write it.
  it('views a draft the caller can no longer write, from the action and the name', async () => {
    getMySubmissions.mockResolvedValue(page([DRAFT], [readOnlyForm('f1')]));
    await renderList();
    await userEvent.click(await screen.findByTestId('s1-view'));
    expect(mockPush).toHaveBeenCalledWith('/en/submission/s1');
    expect(screen.queryByTestId('s1-continue')).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId('my-submission-link-s1'));
    expect(mockPush).toHaveBeenLastCalledWith('/en/submission/s1');
    // Delete does not need the write: an owner still deletes their own draft.
    expect(screen.getByTestId('s1-delete')).toBeInTheDocument();
  });

  it('views a row whose form came without its facts', async () => {
    getMySubmissions.mockResolvedValue(page([DRAFT], []));
    await renderList();
    expect(await screen.findByTestId('s1-view')).toBeInTheDocument();
    expect(screen.queryByTestId('s1-continue')).not.toBeInTheDocument();
  });

  it.each([
    ['whose provider is unknown', null],
    ['who is the public user', 'public'],
  ])('offers a caller %s no Continue and no Delete', async (_label, idpCode) => {
    access.caller = { idpCode };
    await renderList();
    expect(await screen.findByTestId('s1-view')).toBeInTheDocument();
    expect(screen.queryByTestId('s1-continue')).not.toBeInTheDocument();
    expect(screen.queryByTestId('s1-delete')).not.toBeInTheDocument();
  });

  it.each([
    ['mySubmissions.state=draft', 'draft'],
    ['mySubmissions.state=submitted', 'submitted'],
  ])('reads the state filter from %s', async (query, expected) => {
    search.value = query;
    await renderList();
    expect(lastRequest().workflowState).toBe(expected);
  });

  it('drops a state the API would refuse from the URL', async () => {
    search.value = 'mySubmissions.state=opened';
    await renderList();
    expect(lastRequest().workflowState).toBeUndefined();
    await waitFor(() => expect(replaceState).toHaveBeenCalled());
    expect(String(replaceState.mock.calls.at(-1)?.[2])).not.toContain('mySubmissions.state');
  });

  it('reads again when the status filter changes', async () => {
    const view = await renderList();
    await screen.findByTestId('s1-status');

    const picker = screen.getByTestId('my-submissions-state-select').querySelector('select')!;
    await act(async () => {
      fireEvent.change(picker, { target: { value: 'submitted' } });
    });
    await waitFor(() => expect(replaceState).toHaveBeenCalled());
    expect(String(replaceState.mock.calls.at(-1)?.[2])).toContain('mySubmissions.state=submitted');

    await syncUrl(view);
    await waitFor(() => expect(lastRequest().workflowState).toBe('submitted'));
  });

  it('resets the filter and the search together', async () => {
    search.value = 'mySubmissions.state=draft&mySubmissions.q=tax';
    await renderList();
    await userEvent.click(screen.getByTestId('my-submissions-clear-filters'));
    await waitFor(() => expect(replaceState).toHaveBeenCalled());
    const url = String(replaceState.mock.calls.at(-1)?.[2]);
    expect(url).not.toContain('mySubmissions.state');
    expect(url).not.toContain('mySubmissions.q');
  });

  it('says there is nothing yet when the unfiltered list is empty', async () => {
    getMySubmissions.mockResolvedValue(page([]));
    await renderList();
    expect(await screen.findByTestId('datatable-empty')).toHaveTextContent(
      'You have no submissions yet.',
    );
  });

  it('says nothing matched when a search or filter is applied', async () => {
    getMySubmissions.mockResolvedValue(page([]));
    search.value = 'mySubmissions.q=tax';
    await renderList();
    expect(await screen.findByTestId('datatable-empty')).toHaveTextContent(
      'No submissions match your search or filter.',
    );
  });

  it('deletes a draft after confirmation and re-reads the list', async () => {
    await renderList();
    await userEvent.click(await screen.findByTestId('s1-delete'));
    expect(screen.getByTestId('confirm-modal-message')).toHaveTextContent(
      `Your draft of Permit application, last updated ${DRAFT_UPDATED}, will be deleted.`,
    );

    getMySubmissions.mockResolvedValue(page([SUBMITTED]));
    await userEvent.click(screen.getByTestId('confirm-modal-confirm'));

    expect(deleteSubmitSubmission).toHaveBeenCalledWith('token', 's1');
    await waitFor(() =>
      expect(addNotification).toHaveBeenCalledWith({ text: 'Draft deleted.', type: 'success' }),
    );
    await waitFor(() => expect(screen.queryByTestId('s1-status')).not.toBeInTheDocument());
    expect(screen.queryByTestId('confirm-modal-message')).not.toBeInTheDocument();
  });

  it('deletes nothing, and says the session ended, when the session holds no token', async () => {
    await renderList();
    await userEvent.click(await screen.findByTestId('s1-delete'));
    await act(async () => {
      store.dispatch(setToken(undefined));
    });
    await userEvent.click(screen.getByTestId('confirm-modal-confirm'));

    await waitFor(() =>
      expect(addNotification).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'Your session has ended.', type: 'error' }),
      ),
    );
    expect(deleteSubmitSubmission).not.toHaveBeenCalled();
  });

  it('holds the dialog open, with confirm disabled, until the delete settles', async () => {
    const settle = deferredDelete();
    await renderList();
    await userEvent.click(await screen.findByTestId('s1-delete'));
    await userEvent.click(screen.getByTestId('confirm-modal-confirm'));

    expect(screen.getByTestId('confirm-modal-confirm')).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByTestId('confirm-modal-message')).toBeInTheDocument();

    await act(async () => settle());
    await waitFor(() =>
      expect(screen.queryByTestId('confirm-modal-message')).not.toBeInTheDocument(),
    );
  });

  it.each([
    [
      'a draft submitted elsewhere',
      new ApiError('Submission is submitted', 409, 'delete_closed'),
      'Already submitted, so it stays.',
    ],
    [
      'a draft submitted elsewhere, refused without a code',
      new ApiError('Submission is submitted', 409),
      'Already submitted, so it stays.',
    ],
    [
      'a caller who may not delete it',
      new ApiError('Not authorized to delete this submission', 403, 'delete_denied'),
      'Only its owner can delete it.',
    ],
    ['an ended session', new SessionExpiredError(), 'Your session has ended.'],
    ['any other failure', new Error('boom'), 'Could not delete this draft.'],
  ])('reports %s and still re-reads the list', async (_label, refused, text) => {
    deleteSubmitSubmission.mockRejectedValue(refused);
    await renderList();
    await userEvent.click(await screen.findByTestId('s1-delete'));
    const calls = getMySubmissions.mock.calls.length;
    await userEvent.click(screen.getByTestId('confirm-modal-confirm'));

    await waitFor(() =>
      expect(addNotification).toHaveBeenCalledWith({ text, type: 'error', consoleError: refused }),
    );
    expect(getMySubmissions.mock.calls.length).toBeGreaterThan(calls);
  });

  it('does not delete when the confirmation is cancelled', async () => {
    await renderList();
    await userEvent.click(await screen.findByTestId('s1-delete'));
    await userEvent.click(screen.getByTestId('confirm-modal-cancel'));
    expect(deleteSubmitSubmission).not.toHaveBeenCalled();
  });

  it('asks a signed-out visitor to sign in', async () => {
    kc.authenticated = false;
    await renderList();
    expect(screen.getByText('Not authed')).toBeInTheDocument();
    expect(within(document.body).queryByRole('table')).not.toBeInTheDocument();
  });
});
