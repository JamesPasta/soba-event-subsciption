import React, { act } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Provider } from 'react-redux';
import { SWRConfig } from 'swr';

const { mockGetSubmissions, mockGetForm, mockDelete, mockPush, search, dict } = vi.hoisted(() => ({
  mockGetSubmissions: vi.fn(),
  mockGetForm: vi.fn(),
  mockDelete: vi.fn(),
  mockPush: vi.fn(),
  search: { value: '' },
  dict: {
    locale: 'en',
    general: {
      loading: 'Loading...',
      version: 'Version',
      sortBy: 'Sort by',
      sessionExpired: 'Your session has ended.',
      noAccess: 'You do not have access to this.',
      cancel: 'Cancel',
    },
    dataTable: { itemName: 'items', pageOf: 'of {totalPages} page(s)' },
    modal: { close: 'Close', dialogActions: 'Dialog actions' },
    form: { status: 'Status' },
    workspaces: { cancel: 'Cancel' },
    submission: {
      confirmationId: 'Confirmation ID',
      submitter: 'Submitter',
      anon: 'Anonymous',
      submittedAt: 'Submission Date',
      actions: 'Actions',
      view: 'View',
      delete: 'Delete',
      deleteTitle: 'Delete submission',
      deleteMessage: 'Submission {confirmation} from {submitter} will be deleted.',
      deleteDraftMessage:
        'The unsubmitted submission from {submitter}, last updated {updated}, will be deleted.',
      deleteSuccess: 'Submission deleted.',
      deleteFailure: 'Could not delete the submission.',
      emptyList: 'No submissions',
      submissions: 'Submissions',
      error: 'Could not load submissions.',
      review: {
        assignedTo: 'Assigned To',
        listStatusFilter: 'Review status',
        listAllStatuses: 'All',
        assignedToMeFilter: 'Assigned to me',
        statuses: {
          SUBMITTED: 'Submitted',
          ASSIGNED: 'Assigned',
          REVISING: 'Revising',
          COMPLETED: 'Completed',
        },
      },
      export: { button: 'Export submissions' },
    },
  },
}));

vi.mock('@/src/shared/api/sobaApi', () => ({
  getSobaSubmissions: (...args: unknown[]) => mockGetSubmissions(...args),
  getSobaForm: (...args: unknown[]) => mockGetForm(...args),
  deleteSobaSubmission: (...args: unknown[]) => mockDelete(...args),
  fetchCurrentUser: async () => ({ actor: { id: 'u-me', displayLabel: 'Me' } }),
}));

vi.mock('@/app/[lang]/Providers', () => ({
  useDictionary: () => dict,
}));

// Whether this app offers submission export, which the real hook reads from the features list.
const exportsAllowed = vi.hoisted(() => ({ value: true as boolean | null }));
vi.mock('@/src/shared/api/useFeatureAllowed', () => ({
  useFeatureAllowed: () => exportsAllowed.value,
}));

vi.mock('next/navigation', async () => {
  const actual = await vi.importActual<unknown>('next/navigation');
  return {
    ...(actual as Record<string, unknown>),
    useRouter: () => ({ push: mockPush, replace: vi.fn() }),
    usePathname: () => '/en/build/f1',
    useSearchParams: () => new URLSearchParams(search.value),
  };
});

import makeStore from '@/lib/store';
import { setAuthenticated, setToken } from '@/lib/slices/keycloakSlice';
import FormSubmissionTab from '@/src/features/designer/ui/FormSubmissionTab';
import type { Dictionary } from '@/src/types/dictionary';

describe('FormSubmissionTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    search.value = '';
    exportsAllowed.value = true;
    mockGetForm.mockResolvedValue({
      id: 'f1',
      permissions: ['submission_read', 'submission_delete'],
    });
    mockGetSubmissions.mockResolvedValue({
      items: [
        {
          id: 'sub-1',
          formId: 'f1',
          formVersionId: 'v1',
          versionNo: 1,
          workflowState: 'submitted',
          engineSyncStatus: 'ready',
          submittedAt: '2026-01-02T03:04:05.000Z',
          createdAt: '2026-01-02T03:04:05.000Z',
          updatedAt: '2026-01-02T03:04:05.000Z',
          createdBy: 'Ada Lovelace',
          confirmationCode: 'K7M2Q9XA',
        },
        {
          id: 'sub-2',
          formId: 'f1',
          formVersionId: 'v1',
          versionNo: 1,
          workflowState: 'draft',
          engineSyncStatus: 'ready',
          submittedAt: null,
          createdAt: '2026-01-02T03:04:05.000Z',
          updatedAt: '2026-01-02T03:04:05.000Z',
          createdBy: 'Ada Lovelace',
          confirmationCode: null,
        },
      ],
      page: { offset: 0, limit: 10, total: 2 },
    });
  });

  async function renderTab() {
    const store = makeStore();
    store.dispatch(setToken('token'));
    store.dispatch(setAuthenticated(true));

    await act(async () => {
      render(
        <Provider store={store}>
          <SWRConfig
            value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}
          >
            <FormSubmissionTab dict={dict as unknown as Dictionary} formId="f1" opened />
          </SWRConfig>
        </Provider>,
      );
    });
  }

  it('shows the confirmation code of a submitted row and N/A for a draft', async () => {
    await renderTab();
    await waitFor(() => expect(screen.getByTestId('sub-1-confirmation-id')).toBeInTheDocument());
    expect(screen.getByTestId('sub-1-confirmation-id')).toHaveTextContent('K7M2Q9XA');
    expect(screen.getByTestId('sub-2-confirmation-id')).toHaveTextContent('N/A');
  });

  it('opens a submission on the staff submission page', async () => {
    await renderTab();

    const view = await waitFor(() => screen.getByTestId('sub-1-view-link'));
    await act(async () => {
      fireEvent.click(view);
    });

    expect(mockPush).toHaveBeenCalledWith('/en/build/f1/submissions/sub-1');
  });

  it('opens the exports page from the Export submissions button', async () => {
    await renderTab();

    await act(async () => {
      fireEvent.click(screen.getByTestId('submissions-export-button'));
    });

    expect(mockPush).toHaveBeenCalledWith('/en/build/f1/submissions/exports');
  });

  it.each([false, null])(
    'offers no Export submissions button while export is %s',
    async (allowed) => {
      exportsAllowed.value = allowed;
      await renderTab();

      await waitFor(() => expect(screen.getByTestId('sub-1-confirmation-id')).toBeInTheDocument());
      expect(screen.queryByTestId('submissions-export-button')).not.toBeInTheDocument();
    },
  );

  const openDelete = async (id: string) => {
    const link = await waitFor(() => screen.getByTestId(`${id}-delete-link`));
    await act(async () => {
      fireEvent.click(link);
    });
    return screen.findByTestId('confirm-modal-message');
  };

  it('offers Delete only to someone who may delete submissions on the form', async () => {
    mockGetForm.mockResolvedValue({ id: 'f1', permissions: ['submission_read'] });
    await renderTab();

    await waitFor(() => expect(screen.getByTestId('sub-1-view-link')).toBeInTheDocument());
    expect(screen.queryByTestId('sub-1-delete-link')).not.toBeInTheDocument();
  });

  it('offers Delete to a form administrator', async () => {
    mockGetForm.mockResolvedValue({ id: 'f1', permissions: ['*'] });
    await renderTab();

    expect(await screen.findByTestId('sub-1-delete-link')).toBeInTheDocument();
  });

  it('names a submitted submission by its confirmation code before deleting', async () => {
    await renderTab();
    const message = await openDelete('sub-1');
    expect(message).toHaveTextContent('Submission K7M2Q9XA from Ada Lovelace will be deleted.');
  });

  it('names an unsubmitted one by its submitter and last change', async () => {
    await renderTab();
    const message = await openDelete('sub-2');
    expect(message).toHaveTextContent('The unsubmitted submission from Ada Lovelace, last updated');
  });

  it('deletes nothing when the delete is cancelled', async () => {
    await renderTab();
    await openDelete('sub-1');
    await act(async () => {
      fireEvent.click(screen.getByTestId('confirm-modal-cancel'));
    });

    await waitFor(() => expect(screen.queryByTestId('confirm-modal-message')).toBeNull());
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('deletes the submission once confirmed', async () => {
    mockDelete.mockResolvedValue(undefined);
    await renderTab();
    await openDelete('sub-1');
    await act(async () => {
      fireEvent.click(screen.getByTestId('confirm-modal-confirm'));
    });

    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('token', 'sub-1'));
    await waitFor(() => expect(screen.queryByTestId('confirm-modal-message')).toBeNull());
  });

  const withReview = (allowStatusUpdates: boolean) => {
    const page = {
      items: [
        {
          id: 'sub-1',
          formId: 'f1',
          formVersionId: 'v1',
          versionNo: 1,
          workflowState: 'submitted',
          engineSyncStatus: 'ready',
          submittedAt: '2026-01-02T03:04:05.000Z',
          createdAt: '2026-01-02T03:04:05.000Z',
          updatedAt: '2026-01-02T03:04:05.000Z',
          createdBy: 'Ada Lovelace',
          confirmationCode: 'K7M2Q9XA',
          reviewStatus: 'ASSIGNED',
          assignee: { id: 'u-me', displayName: 'Grace Hopper', email: 'grace@example.com' },
        },
        {
          id: 'sub-2',
          formId: 'f1',
          formVersionId: 'v1',
          versionNo: 1,
          workflowState: 'draft',
          engineSyncStatus: 'ready',
          submittedAt: null,
          createdAt: '2026-01-02T03:04:05.000Z',
          updatedAt: '2026-01-02T03:04:05.000Z',
          createdBy: 'Ada Lovelace',
          confirmationCode: null,
          reviewStatus: null,
          assignee: null,
        },
      ],
      page: { offset: 0, limit: 10, total: 2 },
    };
    mockGetSubmissions.mockResolvedValue({ ...page, allowStatusUpdates });
  };

  it('shows the review status and assignee, sortable, when status updates are on', async () => {
    withReview(true);
    await renderTab();

    expect(await screen.findByTestId('sub-1-review-status')).toHaveTextContent('Assigned');
    expect(screen.getByTestId('sub-1-assignee')).toHaveTextContent(
      'Grace Hopper (grace@example.com)',
    );
    expect(screen.getByTestId('form-submissions-review-status-select')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Assigned To/ })).toBeInTheDocument();
  });

  it('hides the review columns and filters when status updates are off', async () => {
    withReview(false);
    await renderTab();

    await waitFor(() => expect(screen.getByTestId('sub-1-status-tag')).toBeInTheDocument());
    expect(screen.queryByTestId('sub-1-assignee')).toBeNull();
    expect(screen.queryByTestId('form-submissions-review-status-select')).toBeNull();
    expect(screen.queryByTestId('form-submissions-mine')).toBeNull();
  });

  it('keeps a filter from the URL clearable when status updates are off', async () => {
    withReview(false);
    search.value = 'formSubmissions.reviewStatus=COMPLETED';
    await renderTab();

    expect(await screen.findByTestId('form-submissions-review-status-select')).toBeInTheDocument();
  });

  it('reads only the submissions at the status and assigned to the caller the URL names', async () => {
    withReview(true);
    search.value = 'formSubmissions.reviewStatus=ASSIGNED&formSubmissions.mine=true';
    await renderTab();

    await waitFor(() =>
      expect(mockGetSubmissions).toHaveBeenLastCalledWith(
        'token',
        expect.objectContaining({ formId: 'f1', reviewStatus: 'ASSIGNED', assigneeId: 'u-me' }),
      ),
    );
  });

  it('puts Assigned to me in the URL when it is ticked', async () => {
    withReview(true);
    const replaceState = vi.spyOn(window.history, 'replaceState');
    await renderTab();

    const mine = await screen.findByTestId('form-submissions-mine');
    await act(async () => {
      fireEvent.click(within(mine).getByRole('checkbox'));
    });

    expect(String(replaceState.mock.calls.at(-1)?.[2])).toContain('formSubmissions.mine=true');
    // Remembered for this form alone, so Back from another form's submission does not recall it.
    expect(sessionStorage.getItem('soba.listQuery.formSubmissions.f1')).toContain('mine');
    expect(sessionStorage.getItem('soba.listQuery.formSubmissions')).toBeNull();
    replaceState.mockRestore();
  });
});
