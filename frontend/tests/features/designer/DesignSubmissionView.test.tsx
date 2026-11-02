import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { act } from 'react';
import { Provider } from 'react-redux';
import { SWRConfig } from 'swr';
import userEvent from '@testing-library/user-event';
import { ApiErrorCodes } from '@soba/lib';
import { navLink } from '@/src/shared/list/listQueryMemory';
import { SubmissionReviewStatuses } from '@/src/types/submissionReview';

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }));

vi.mock('@/app/[lang]/Providers', async () => {
  const dict = { ...(await import('@/dictionaries/en.json')).default, locale: 'en' };
  return { useDictionary: () => dict };
});

vi.mock('next/navigation', () => ({
  usePathname: () => '/en/build/f1/submissions/sub-1',
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('@/src/features/formio-v5/ui/ReadOnlyFormView', () => ({
  ReadOnlyFormView: ({ submission }: { submission: { data: Record<string, unknown> } }) => (
    <div data-testid="submission-view-form" data-answers={JSON.stringify(submission.data)}>
      rendered
    </div>
  ),
}));

// Stands in for Form.io: a button that changes one answer, as typing into the form would, on the
// submission object it was given.
vi.mock('@/src/features/formio-v5/ui/EditableFormView', () => ({
  EditableFormView: ({
    submission,
    onDataChange,
  }: {
    submission: { data: Record<string, unknown> };
    onDataChange: (data: Record<string, unknown>) => void;
  }) => (
    <button
      type="button"
      data-testid="submission-edit-form"
      onClick={() => {
        submission.data.field = 'changed';
        onDataChange(submission.data);
      }}
    >
      edit
    </button>
  ),
}));

const getSobaSubmission = vi.fn();
const getSobaSubmissionData = vi.fn();
const getFormVersionSchema = vi.fn();
const deleteSobaSubmission = vi.fn();
const getSobaSubmissionReview = vi.fn();
const addSobaSubmissionNote = vi.fn();
const updateSobaSubmissionStatus = vi.fn();
const getSobaSubmissionReviewers = vi.fn();
const getSobaForm = vi.fn();
const updateSobaSubmissionData = vi.fn();

const SUBMISSION_ID = '01a0a276-8dee-71e4-8951-5effdc491be0';
const REVIEWER_PERMISSIONS = ['form_read', 'submission_read', 'submission_review'];
const REVIEW = {
  allowStatusUpdates: false,
  statusHistory: [
    {
      id: 's1',
      status: SubmissionReviewStatuses.submitted,
      assignee: null,
      changedAt: '2026-01-02T03:04:05Z',
      updatedBy: 'Ada Lovelace',
    },
  ],
  notes: [],
  editHistory: [],
};
vi.mock('@/src/shared/api/sobaApi', () => ({
  getSobaSubmissionReview: (...args: unknown[]) => getSobaSubmissionReview(...args),
  addSobaSubmissionNote: (...args: unknown[]) => addSobaSubmissionNote(...args),
  updateSobaSubmissionStatus: (...args: unknown[]) => updateSobaSubmissionStatus(...args),
  getSobaSubmissionReviewers: (...args: unknown[]) => getSobaSubmissionReviewers(...args),
  getSobaForm: (...args: unknown[]) => getSobaForm(...args),
  fetchCurrentUser: async () => ({ actor: { id: 'u-rev', displayLabel: 'Rev Iewer' } }),
  deleteSobaSubmission: (...args: unknown[]) => deleteSobaSubmission(...args),
  getSobaSubmission: (...args: unknown[]) => getSobaSubmission(...args),
  getSobaSubmissionData: (...args: unknown[]) => getSobaSubmissionData(...args),
  getFormVersionSchema: (...args: unknown[]) => getFormVersionSchema(...args),
  updateSobaSubmissionData: (...args: unknown[]) => updateSobaSubmissionData(...args),
}));

import makeStore from '@/lib/store';
import { setAuthenticated, setToken } from '@/lib/slices/keycloakSlice';
import { ApiError } from '@/src/shared/api/sobaHelpers';
import { DesignSubmissionView } from '@/src/features/designer/ui/DesignSubmissionView';

let store: ReturnType<typeof makeStore>;

function signIn() {
  store.dispatch(setToken('token'));
  store.dispatch(setAuthenticated(true));
}

// Pass a cache to keep it across mounts, as leaving the page and coming back does.
async function renderView({ cache = new Map(), submissionId = 'sub-1' } = {}) {
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(
      <Provider store={store}>
        <SWRConfig
          value={{ provider: () => cache, dedupingInterval: 0, shouldRetryOnError: false }}
        >
          <DesignSubmissionView formId="f1" submissionId={submissionId} />
        </SWRConfig>
      </Provider>,
    );
  });
  return view;
}

describe('DesignSubmissionView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store = makeStore();
    getSobaSubmission.mockResolvedValue({
      id: '01a0a276-8dee-71e4-8951-5effdc491be0',
      formId: 'f1',
      formName: 'Form One',
      formVersionId: 'v3',
      versionNo: 3,
      workflowState: 'submitted',
      submittedAt: new Date('2026-01-02T03:04:05Z').toISOString(),
      createdBy: 'Ada Lovelace',
      confirmationCode: 'K7M2Q9XA',
      headRevisionId: 'rev-2',
    });
    getFormVersionSchema.mockResolvedValue({ components: [] });
    getSobaSubmissionData.mockResolvedValue({ data: { field: 'value' } });
    getSobaSubmissionReview.mockResolvedValue(REVIEW);
    getSobaForm.mockResolvedValue({ id: 'f1', permissions: REVIEWER_PERMISSIONS });
    getSobaSubmissionReviewers.mockResolvedValue({
      items: [{ id: 'u-rev', displayName: 'Rev Iewer', email: null }],
    });
  });

  it('reads the submission, its version schema and its answers through the design API', async () => {
    signIn();
    await renderView();

    await waitFor(() => expect(screen.getByTestId('submission-view-form')).toBeInTheDocument());
    expect(getSobaSubmission).toHaveBeenCalledWith('token', 'sub-1');
    expect(getFormVersionSchema).toHaveBeenCalledWith('token', 'v3');
    expect(getSobaSubmissionData).toHaveBeenCalledWith('token', 'sub-1');
    expect(screen.getByTestId('submission-view-confirmation')).toHaveTextContent(
      'Confirmation ID: K7M2Q9XA',
    );
    expect(screen.getByTestId('submission-view-submitter')).toHaveTextContent('Ada Lovelace');
  });

  it('reads nothing until the session is ready', async () => {
    await renderView();

    expect(getSobaSubmission).not.toHaveBeenCalled();
    expect(screen.queryByTestId('submission-view-notfound')).not.toBeInTheDocument();
  });

  it('shows an anonymous submitter as anonymous', async () => {
    signIn();
    getSobaSubmission.mockResolvedValue({
      id: 'sub-1',
      formId: 'f1',
      formVersionId: 'v3',
      workflowState: 'draft',
      createdBy: null,
    });
    await renderView();

    await waitFor(() =>
      expect(screen.getByTestId('submission-view-submitter')).toHaveTextContent('Anonymous'),
    );
  });

  it('goes back to the form submissions tab', async () => {
    signIn();
    await renderView();

    await act(async () => {
      fireEvent.click(screen.getByTestId('design-submission-back'));
    });

    expect(mockPush).toHaveBeenCalledWith(navLink('/en/build/f1?tab=submissions'));
  });

  it('prints every review panel open, then reopens only the ones the user had open', async () => {
    signIn();
    await renderView();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Notes' })).toBeInTheDocument());
    const expanded = (name: string) =>
      screen.getByRole('button', { name }).getAttribute('aria-expanded');

    fireEvent.click(screen.getByRole('button', { name: 'Submission' }));
    expect(expanded('Submission')).toBe('false');

    act(() => {
      window.dispatchEvent(new Event('beforeprint'));
    });
    expect([expanded('Status'), expanded('Notes'), expanded('Submission')]).toEqual([
      'true',
      'true',
      'true',
    ]);

    act(() => {
      window.dispatchEvent(new Event('afterprint'));
    });
    expect([expanded('Status'), expanded('Notes'), expanded('Submission')]).toEqual([
      'true',
      'true',
      'false',
    ]);
  });

  it('says there are no answers when the submission has no engine document', async () => {
    signIn();
    getSobaSubmissionData.mockResolvedValue(null);
    await renderView();

    await waitFor(() =>
      expect(screen.getByTestId('submission-view-nocontent')).toBeInTheDocument(),
    );
  });

  it('says not found for a submission that belongs to another form', async () => {
    signIn();
    getSobaSubmission.mockResolvedValue({
      id: 'sub-1',
      formId: 'other-form',
      formVersionId: 'v3',
      workflowState: 'submitted',
    });
    await renderView();

    await waitFor(() => expect(screen.getByTestId('submission-view-notfound')).toBeInTheDocument());
    expect(screen.queryByTestId('submission-view-form')).not.toBeInTheDocument();
  });

  it('says not found when the submission does not exist', async () => {
    signIn();
    getSobaSubmission.mockRejectedValue(new ApiError('Submission not found', 404));
    await renderView();

    await waitFor(() => expect(screen.getByTestId('submission-view-notfound')).toBeInTheDocument());
  });

  it('reports a server failure as a failed load, not a missing submission', async () => {
    signIn();
    getFormVersionSchema.mockRejectedValue(new ApiError('Request failed (500)', 500));
    await renderView();

    await waitFor(() =>
      expect(screen.getByTestId('submission-view-loaderror')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('submission-view-notfound')).not.toBeInTheDocument();
  });

  it('distinguishes a refused read from a missing submission', async () => {
    signIn();
    getSobaSubmission.mockRejectedValue(new ApiError('Forbidden', 403));
    await renderView();

    await waitFor(() => expect(screen.getByTestId('submission-view-noaccess')).toBeInTheDocument());
  });

  it('distinguishes an ended session from a missing submission', async () => {
    signIn();
    const expired = new Error('Session expired');
    expired.name = 'SessionExpiredError';
    getSobaSubmission.mockRejectedValue(expired);
    await renderView();

    await waitFor(() =>
      expect(screen.getByTestId('submission-view-session-expired')).toBeInTheDocument(),
    );
  });

  it('adds a note and lists it under the reviewer', async () => {
    signIn();
    addSobaSubmissionNote.mockResolvedValue({
      ...REVIEW,
      notes: [
        {
          id: 'n1',
          text: 'Needs a second look',
          createdAt: '2026-01-03T03:04:05Z',
          createdBy: 'Rev Iewer',
        },
      ],
    });
    await renderView();
    // The test id lands on the design-system wrapper, so the field is found by its label.
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Note' })).toBeInTheDocument());

    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), {
      target: { value: 'Needs a second look' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('submission-note-add'));
    });

    await waitFor(() =>
      expect(screen.getByTestId('submission-notes-list')).toHaveTextContent('Needs a second look'),
    );
    expect(addSobaSubmissionNote).toHaveBeenCalledWith('token', SUBMISSION_ID, {
      id: expect.any(String),
      text: 'Needs a second look',
    });
    expect(screen.getByTestId('submission-notes-list')).toHaveTextContent('Rev Iewer');
  });

  it('starts a submission as submitted and unassigned', async () => {
    signIn();
    await renderView();

    await waitFor(() =>
      expect(screen.getByTestId('submission-status-current')).toHaveTextContent(
        'Current Status: Submitted',
      ),
    );
    expect(screen.getByTestId('submission-status-assignee')).toHaveTextContent('Unassigned');
  });

  it('shows real review data, without the sample-data notice', async () => {
    signIn();
    await renderView();

    await waitFor(() =>
      expect(screen.getByTestId('submission-status-current')).toBeInTheDocument(),
    );
    expect(screen.queryByText(/sample data/i)).not.toBeInTheDocument();
    expect(getSobaSubmissionReview).toHaveBeenCalledWith('token', SUBMISSION_ID);
  });

  // Notes are for reviewers; anyone else who reads the submission sees them without the box.
  it('lists the notes without a note box for a caller who cannot review', async () => {
    signIn();
    getSobaForm.mockResolvedValue({ id: 'f1', permissions: ['form_read', 'submission_read'] });
    getSobaSubmissionReview.mockResolvedValue({
      ...REVIEW,
      notes: [
        { id: 'n1', text: 'Checked', createdAt: '2026-01-03T03:04:05Z', createdBy: 'Rev Iewer' },
      ],
    });
    await renderView();

    await waitFor(() =>
      expect(screen.getByTestId('submission-notes-list')).toHaveTextContent('Checked'),
    );
    expect(screen.queryByTestId('submission-note-add')).not.toBeInTheDocument();
    expect(getSobaForm).toHaveBeenCalledWith('token', 'f1');
  });

  // A note whose answer was lost is sent again under the same id, so it is added once.
  it('retries a failed note under the same id', async () => {
    signIn();
    addSobaSubmissionNote
      .mockRejectedValueOnce(new ApiError('Request failed (500)', 500))
      .mockResolvedValueOnce(REVIEW);
    await renderView();
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Note' })).toBeInTheDocument());

    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), {
      target: { value: 'Needs a second look' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('submission-note-add'));
    });
    await waitFor(() => expect(addSobaSubmissionNote).toHaveBeenCalledTimes(1));
    await act(async () => {
      fireEvent.click(screen.getByTestId('submission-note-add'));
    });

    await waitFor(() => expect(addSobaSubmissionNote).toHaveBeenCalledTimes(2));
    const [first, second] = addSobaSubmissionNote.mock.calls.map((call) => call[2]);
    expect(second).toEqual(first);
  });

  describe('status changes', () => {
    const UPDATES_ON = { ...REVIEW, allowStatusUpdates: true };

    /** Picks `option` in the status select and saves it. */
    async function changeStatusTo(option: string) {
      const user = userEvent.setup();
      const select = await screen.findByTestId('submission-status-select');
      await user.click(within(select).getByRole('button'));
      await user.click(await screen.findByRole('option', { name: option }));
      await user.click(screen.getByTestId('submission-status-update'));
    }

    it("offers no status change, and says why, when the form's settings turn it off", async () => {
      signIn();
      await renderView();

      await waitFor(() =>
        expect(screen.getByTestId('submission-status-updates-off')).toBeInTheDocument(),
      );
      expect(screen.queryByTestId('submission-status-select')).not.toBeInTheDocument();
      expect(getSobaSubmissionReviewers).not.toHaveBeenCalled();
    });

    it('offers the way out of a revision even with status changes turned off', async () => {
      signIn();
      getSobaSubmissionReview.mockResolvedValue({
        ...REVIEW,
        statusHistory: [
          { ...REVIEW.statusHistory[0], status: SubmissionReviewStatuses.revising },
          ...REVIEW.statusHistory,
        ],
      });
      await renderView();

      expect(await screen.findByTestId('submission-status-select')).toBeInTheDocument();
      expect(screen.queryByTestId('submission-status-updates-off')).not.toBeInTheDocument();
    });

    it('says when it cannot read who a submission can be assigned to', async () => {
      signIn();
      getSobaSubmissionReview.mockResolvedValue(UPDATES_ON);
      getSobaSubmissionReviewers.mockRejectedValue(new ApiError('Request failed (500)', 500));
      await renderView();

      expect(await screen.findByTestId('submission-reviewers-loaderror')).toBeInTheDocument();
    });

    // A move in or out of Revising changes the workflow state and can change the answers.
    it('reads the submission again after a change, so the page shows where it now stands', async () => {
      signIn();
      getSobaSubmissionReview.mockResolvedValue(UPDATES_ON);
      updateSobaSubmissionStatus.mockResolvedValue({
        ...UPDATES_ON,
        statusHistory: [
          { ...UPDATES_ON.statusHistory[0], id: 's2', status: SubmissionReviewStatuses.revising },
          ...UPDATES_ON.statusHistory,
        ],
      });
      await renderView({ submissionId: SUBMISSION_ID });
      expect(await screen.findByTestId('submission-view-status')).toHaveTextContent('SUBMITTED');

      getSobaSubmission.mockResolvedValue({
        ...(await getSobaSubmission()),
        workflowState: 'revising',
      });
      await changeStatusTo('Revising');

      await waitFor(() =>
        expect(screen.getByTestId('submission-view-status')).toHaveTextContent('REVISING'),
      );
    });

    it('offers no status change to a caller who cannot review', async () => {
      signIn();
      getSobaForm.mockResolvedValue({ id: 'f1', permissions: ['form_read', 'submission_read'] });
      getSobaSubmissionReview.mockResolvedValue(UPDATES_ON);
      await renderView();

      await waitFor(() =>
        expect(screen.getByTestId('submission-status-current')).toBeInTheDocument(),
      );
      expect(screen.queryByTestId('submission-status-select')).not.toBeInTheDocument();
      expect(screen.queryByTestId('submission-status-updates-off')).not.toBeInTheDocument();
      expect(getSobaSubmissionReviewers).not.toHaveBeenCalled();
    });

    it('completes the submission from the status it showed, and shows the new status', async () => {
      signIn();
      getSobaSubmissionReview.mockResolvedValue(UPDATES_ON);
      updateSobaSubmissionStatus.mockResolvedValue({
        ...UPDATES_ON,
        statusHistory: [
          { ...UPDATES_ON.statusHistory[0], id: 's2', status: SubmissionReviewStatuses.completed },
          ...UPDATES_ON.statusHistory,
        ],
      });
      await renderView();

      await changeStatusTo('Completed');

      await waitFor(() =>
        expect(screen.getByTestId('submission-status-current')).toHaveTextContent('Completed'),
      );
      expect(updateSobaSubmissionStatus).toHaveBeenCalledWith('token', SUBMISSION_ID, {
        id: expect.any(String),
        fromStatusId: 's1',
        status: SubmissionReviewStatuses.completed,
        assigneeId: null,
      });
      expect(getSobaSubmissionReviewers).toHaveBeenCalledWith('token', SUBMISSION_ID);
    });

    // A change whose answer was lost is sent again under the same id, so it is made once.
    it('retries a failed change under the same id', async () => {
      signIn();
      getSobaSubmissionReview.mockResolvedValue(UPDATES_ON);
      updateSobaSubmissionStatus
        .mockRejectedValueOnce(new ApiError('Request failed (500)', 500))
        .mockResolvedValueOnce(UPDATES_ON);
      await renderView();

      await changeStatusTo('Completed');
      await waitFor(() => expect(updateSobaSubmissionStatus).toHaveBeenCalledTimes(1));
      await act(async () => {
        fireEvent.click(screen.getByTestId('submission-status-update'));
      });

      await waitFor(() => expect(updateSobaSubmissionStatus).toHaveBeenCalledTimes(2));
      const [first, second] = updateSobaSubmissionStatus.mock.calls.map((call) => call[2]);
      expect(second).toEqual(first);
    });

    it('reads the review again when someone else changed the status first', async () => {
      signIn();
      getSobaSubmissionReview.mockResolvedValue(UPDATES_ON);
      updateSobaSubmissionStatus.mockRejectedValue(
        new ApiError('Conflict', 409, ApiErrorCodes.status_changed),
      );
      await renderView();
      await waitFor(() => expect(getSobaSubmissionReview).toHaveBeenCalledTimes(1));

      await changeStatusTo('Completed');

      await waitFor(() => expect(getSobaSubmissionReview).toHaveBeenCalledTimes(2));
    });
  });

  it('does not offer to change the answers yet', async () => {
    signIn();
    await renderView();

    await waitFor(() => expect(screen.getByTestId('submission-data-history')).toBeInTheDocument());
    expect(screen.queryByTestId('submission-data-update')).not.toBeInTheDocument();
  });

  it('deletes the submission and returns to the submissions tab', async () => {
    signIn();
    deleteSobaSubmission.mockResolvedValue(undefined);
    await renderView();
    await waitFor(() => expect(screen.getByTestId('submission-review-delete')).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByTestId('submission-review-delete'));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('confirm-modal-confirm'));
    });

    await waitFor(() => expect(deleteSobaSubmission).toHaveBeenCalledWith('token', SUBMISSION_ID));
    expect(mockPush).toHaveBeenCalledWith(navLink('/en/build/f1?tab=submissions'));
  });

  const notifications = () =>
    store.getState().notification.notifications.map((notification) => notification.text);

  it('says a note could not be saved, and keeps the list and what was typed', async () => {
    signIn();
    addSobaSubmissionNote.mockRejectedValue(new ApiError('Request failed (500)', 500));
    await renderView();
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Note' })).toBeInTheDocument());

    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), {
      target: { value: 'Will not save' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('submission-note-add'));
    });

    await waitFor(() => expect(notifications()).toContain('Could not save your change.'));
    expect(screen.getByTestId('submission-notes-empty')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue('Will not save');
  });

  it('keeps Add Note off for a note that is only spaces', async () => {
    signIn();
    await renderView();
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Note' })).toBeInTheDocument());

    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), { target: { value: '   ' } });

    expect(screen.getByTestId('submission-note-add')).toBeDisabled();
  });

  it('lists the edits in the submitted data history', async () => {
    signIn();
    getSobaSubmissionReview.mockResolvedValue({
      ...REVIEW,
      editHistory: [{ id: 'e1', editedAt: '2026-01-03T03:04:05Z', editedBy: 'Grace Hopper' }],
    });
    await renderView();
    await waitFor(() => expect(screen.getByTestId('submission-data-history')).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByTestId('submission-data-history'));
    });

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByTestId('submission-history-intro')).toHaveTextContent('audit log');
    expect(within(dialog).getByText('Grace Hopper')).toBeInTheDocument();
  });

  it('stays on the page and says so when the delete fails', async () => {
    signIn();
    deleteSobaSubmission.mockRejectedValue(new ApiError('Request failed (500)', 500));
    await renderView();
    await waitFor(() => expect(screen.getByTestId('submission-review-delete')).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByTestId('submission-review-delete'));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('confirm-modal-confirm'));
    });

    await waitFor(() => expect(notifications()).toContain('Failed to delete submission'));
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('reads a deleted submission again when the page is opened after the delete', async () => {
    signIn();
    deleteSobaSubmission.mockResolvedValue(undefined);
    const cache = new Map();
    const first = await renderView({ cache, submissionId: SUBMISSION_ID });
    await waitFor(() => expect(screen.getByTestId('submission-review-delete')).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByTestId('submission-review-delete'));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('confirm-modal-confirm'));
    });
    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    first.unmount();

    getSobaSubmission.mockRejectedValue(new ApiError('Submission not found', 404));
    await renderView({ cache, submissionId: SUBMISSION_ID });

    await waitFor(() => expect(screen.getByTestId('submission-view-notfound')).toBeInTheDocument());
    expect(screen.queryByTestId('submission-review-delete')).not.toBeInTheDocument();
  });

  it('says so when the caller may not add a note', async () => {
    signIn();
    addSobaSubmissionNote.mockRejectedValue(new ApiError('Forbidden', 403));
    await renderView();
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Note' })).toBeInTheDocument());

    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), {
      target: { value: 'Will not save' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('submission-note-add'));
    });

    await waitFor(() => expect(notifications()).toContain('You do not have access to this.'));
  });

  it('leaves the data history open when a note saved before it was opened lands', async () => {
    signIn();
    let saveNote: (review: typeof REVIEW) => void = () => {};
    addSobaSubmissionNote.mockReturnValue(
      new Promise((resolve) => {
        saveNote = resolve;
      }),
    );
    await renderView();
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Note' })).toBeInTheDocument());

    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), {
      target: { value: 'Needs a second look' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('submission-note-add'));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('submission-data-history'));
    });
    await act(async () => {
      saveNote(REVIEW);
    });

    await waitFor(() => expect(notifications()).toContain('Note added'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('still shows the answers when the review cannot be read', async () => {
    signIn();
    getSobaSubmissionReview.mockRejectedValue(new ApiError('Request failed (500)', 500));
    await renderView();

    await waitFor(() =>
      expect(screen.getByTestId('submission-review-loaderror')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('submission-view-form')).toBeInTheDocument();
    expect(screen.queryByTestId('submission-status-current')).not.toBeInTheDocument();
    expect(screen.queryByTestId('submission-note-add')).not.toBeInTheDocument();
  });

  it('says so when the caller may not read the review', async () => {
    signIn();
    getSobaSubmissionReview.mockRejectedValue(new ApiError('Forbidden', 403));
    await renderView();

    await waitFor(() =>
      expect(screen.getByTestId('submission-review-loaderror')).toHaveTextContent(
        'You do not have access to this.',
      ),
    );
  });

  it('shows a draft as a draft, with nothing submitted to change', async () => {
    signIn();
    getSobaSubmission.mockResolvedValue({
      id: SUBMISSION_ID,
      formId: 'f1',
      formVersionId: 'v3',
      workflowState: 'draft',
      submittedAt: null,
      confirmationCode: null,
      createdBy: 'Ada Lovelace',
    });
    await renderView();

    await waitFor(() =>
      expect(screen.getByTestId('submission-view-status')).toHaveTextContent('DRAFT'),
    );
    expect(screen.queryByTestId('submission-view-submitted')).not.toBeInTheDocument();
    expect(screen.queryByTestId('submission-view-confirmation')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('submission-note-add')).toBeInTheDocument());
    expect(screen.queryByTestId('submission-data-history')).not.toBeInTheDocument();
  });
});

describe('DesignSubmissionView staff edits', () => {
  const EDITOR_PERMISSIONS = [...REVIEWER_PERMISSIONS, 'submission_update'];

  beforeEach(() => {
    vi.clearAllMocks();
    store = makeStore();
    getSobaSubmission.mockResolvedValue({
      id: SUBMISSION_ID,
      formId: 'f1',
      formName: 'Form One',
      formVersionId: 'v3',
      versionNo: 3,
      workflowState: 'submitted',
      submittedAt: '2026-01-02T03:04:05Z',
      createdBy: 'Ada Lovelace',
      confirmationCode: 'K7M2Q9XA',
      headRevisionId: 'rev-2',
    });
    getFormVersionSchema.mockResolvedValue({ components: [] });
    getSobaSubmissionData.mockResolvedValue({ data: { field: 'value' } });
    getSobaSubmissionReview.mockResolvedValue(REVIEW);
    getSobaForm.mockResolvedValue({ id: 'f1', permissions: EDITOR_PERMISSIONS });
    updateSobaSubmissionData.mockResolvedValue({ id: SUBMISSION_ID });
    signIn();
  });

  it('offers no Edit without submission_update', async () => {
    getSobaForm.mockResolvedValue({ id: 'f1', permissions: REVIEWER_PERMISSIONS });
    await renderView({ submissionId: SUBMISSION_ID });

    await screen.findByTestId('submission-data-history');
    expect(screen.queryByTestId('submission-edit')).toBeNull();
  });

  it('offers no Edit while the submission is sent back to revise', async () => {
    getSobaSubmission.mockResolvedValue({
      ...(await getSobaSubmission()),
      workflowState: 'revising',
    });
    await renderView({ submissionId: SUBMISSION_ID });

    await screen.findByTestId('submission-data-history');
    expect(screen.queryByTestId('submission-edit')).toBeNull();
  });

  it('saves the changed answers after confirmation, from the revision on screen', async () => {
    const user = userEvent.setup();
    await renderView({ submissionId: SUBMISSION_ID });

    await user.click(await screen.findByTestId('submission-edit'));
    expect(screen.getByTestId('submission-edit-notice')).toBeInTheDocument();
    await user.click(screen.getByTestId('submission-edit-form'));
    await user.click(screen.getByTestId('submission-edit-update'));
    expect(
      await screen.findByText('Are you sure you want to change the submitted data?'),
    ).toBeVisible();
    await user.click(screen.getByTestId('confirm-modal-confirm'));

    await waitFor(() =>
      expect(updateSobaSubmissionData).toHaveBeenCalledWith('token', SUBMISSION_ID, {
        data: { field: 'changed' },
        revisionId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        baseRevisionId: 'rev-2',
      }),
    );
    // The answers and the edit history are read again, and the form goes back to read-only.
    await waitFor(() => expect(screen.queryByTestId('submission-edit-form')).toBeNull());
    expect(getSobaSubmissionReview.mock.calls.length).toBeGreaterThan(1);
  });

  it('retries a failed save under the same revision id', async () => {
    const user = userEvent.setup();
    updateSobaSubmissionData.mockRejectedValueOnce(new Error('network'));
    await renderView({ submissionId: SUBMISSION_ID });

    await user.click(await screen.findByTestId('submission-edit'));
    await user.click(screen.getByTestId('submission-edit-form'));
    for (let attempt = 0; attempt < 2; attempt++) {
      await user.click(screen.getByTestId('submission-edit-update'));
      await user.click(await screen.findByTestId('confirm-modal-confirm'));
      await waitFor(() => expect(updateSobaSubmissionData).toHaveBeenCalledTimes(attempt + 1));
    }

    const [first, second] = updateSobaSubmissionData.mock.calls;
    expect(second[2].revisionId).toBe(first[2].revisionId);
  });

  it.each([ApiErrorCodes.data_changed, ApiErrorCodes.edit_closed])(
    're-reads the submission and ends the edit on %s',
    async (code) => {
      const user = userEvent.setup();
      updateSobaSubmissionData.mockRejectedValue(new ApiError('conflict', 409, code));
      await renderView({ submissionId: SUBMISSION_ID });
      const readsBefore = getSobaSubmission.mock.calls.length;

      await user.click(await screen.findByTestId('submission-edit'));
      await user.click(screen.getByTestId('submission-edit-form'));
      await user.click(screen.getByTestId('submission-edit-update'));
      await user.click(await screen.findByTestId('confirm-modal-confirm'));

      await waitFor(() => expect(getSobaSubmission.mock.calls.length).toBeGreaterThan(readsBefore));
      await waitFor(() => expect(screen.queryByTestId('submission-edit-form')).toBeNull());
    },
  );

  it('ends the edit for good when the submission goes back to its submitters', async () => {
    const user = userEvent.setup();
    const reviewAt = (status: string) => ({
      ...REVIEW,
      allowStatusUpdates: true,
      statusHistory: [{ ...REVIEW.statusHistory[0], id: status, status }, ...REVIEW.statusHistory],
    });
    const moveTo = async (option: string) => {
      const select = await screen.findByTestId('submission-status-select');
      await user.click(within(select).getByRole('button'));
      await user.click(await screen.findByRole('option', { name: option }));
      await user.click(screen.getByTestId('submission-status-update'));
    };
    getSobaSubmissionReview.mockResolvedValue({ ...REVIEW, allowStatusUpdates: true });
    getSobaSubmissionReviewers.mockResolvedValue({ items: [] });
    const submitted = await getSobaSubmission();
    await renderView({ submissionId: SUBMISSION_ID });

    await user.click(await screen.findByTestId('submission-edit'));
    await user.click(screen.getByTestId('submission-edit-form'));

    getSobaSubmission.mockResolvedValue({ ...submitted, workflowState: 'revising' });
    updateSobaSubmissionStatus.mockResolvedValueOnce(reviewAt(SubmissionReviewStatuses.revising));
    await moveTo('Revising');
    await waitFor(() => expect(screen.queryByTestId('submission-edit-form')).toBeNull());

    getSobaSubmission.mockResolvedValue(submitted);
    updateSobaSubmissionStatus.mockResolvedValueOnce(reviewAt(SubmissionReviewStatuses.completed));
    await moveTo('Completed');

    expect(await screen.findByTestId('submission-edit')).toBeInTheDocument();
    expect(screen.queryByTestId('submission-edit-form')).toBeNull();
  });

  it('holds Update until an answer changes', async () => {
    const user = userEvent.setup();
    await renderView({ submissionId: SUBMISSION_ID });

    await user.click(await screen.findByTestId('submission-edit'));
    expect(screen.getByTestId('submission-edit-update')).toBeDisabled();

    await user.click(screen.getByTestId('submission-edit-form'));
    expect(screen.getByTestId('submission-edit-update')).toBeEnabled();
  });

  it('discards what was typed on Cancel, in the view and in the next edit', async () => {
    const user = userEvent.setup();
    await renderView({ submissionId: SUBMISSION_ID });

    await user.click(await screen.findByTestId('submission-edit'));
    await user.click(screen.getByTestId('submission-edit-form'));
    await user.click(screen.getByTestId('submission-edit-cancel'));

    expect(screen.getByTestId('submission-view-form')).toHaveAttribute(
      'data-answers',
      JSON.stringify({ field: 'value' }),
    );
    expect(updateSobaSubmissionData).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('submission-edit'));
    expect(screen.getByTestId('submission-edit-update')).toBeDisabled();
  });
});
