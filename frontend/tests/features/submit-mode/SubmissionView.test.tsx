import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { Provider } from 'react-redux';
import { SWRConfig } from 'swr';

vi.mock('@/app/[lang]/Providers', () => ({
  useDictionary: () => ({
    locale: 'en',
    general: {
      loading: 'Loading...',
      sessionExpired: 'Your session has ended.',
      noAccess: 'You do not have access to this.',
    },
    form: { nameLabel: 'Form', templates: { print: { button: 'Print' } } },
    submission: {
      success: {
        message: 'Submitted successfully.',
        keepConfirmation: 'Keep this ID.',
        notSubmitted: 'Not submitted yet.',
      },
      confirmationId: 'Confirmation ID',
      notFound: 'Submission not found.',
      loadError: 'Could not load this submission.',
      noContent: 'No submitted answers to display.',
      submittedOn: 'Submitted',
    },
    mySubmissions: {
      viewAll: 'View my submissions',
      continue: 'Continue',
      reviewStatuses: { completed: 'Completed', revisionRequested: 'Revision requested' },
    },
  }),
}));

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useParams: () => ({ submissionId: 'sub-1' }),
  usePathname: () => '/en/submission/sub-1/success',
  useRouter: () => ({ push }),
}));

vi.mock('@/src/features/formio-v5/ui/ReadOnlyFormView', () => ({
  ReadOnlyFormView: vi.fn(() => <div data-testid="submission-view-form">rendered</div>),
}));

const getSubmitSubmission = vi.fn();
const getSubmitSubmissionSchema = vi.fn();
const getSubmitSubmissionData = vi.fn();
vi.mock('@/src/shared/api/sobaApi', () => ({
  getSubmitSubmission: (...args: unknown[]) => getSubmitSubmission(...args),
  getSubmitSubmissionSchema: (...args: unknown[]) => getSubmitSubmissionSchema(...args),
  getSubmitSubmissionData: (...args: unknown[]) => getSubmitSubmissionData(...args),
}));

import makeStore from '@/lib/store';
import { initKeycloak, setAuthenticated, setToken } from '@/lib/slices/keycloakSlice';
import { ApiError } from '@/src/shared/api/sobaHelpers';
import { SubmissionView } from '@/src/features/submit-mode/ui/SubmissionView';
import { ReadOnlyFormView } from '@/src/features/formio-v5/ui/ReadOnlyFormView';

let store: ReturnType<typeof makeStore>;

function viewTree() {
  return (
    <Provider store={store}>
      <SWRConfig
        value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}
      >
        <SubmissionView />
      </SWRConfig>
    </Provider>
  );
}

async function renderView(success = false) {
  let view: ReturnType<typeof render> | undefined;
  await act(async () => {
    view = render(
      <Provider store={store}>
        <SWRConfig
          value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}
        >
          <SubmissionView success={success} />
        </SWRConfig>
      </Provider>,
    );
  });
  return view!;
}

describe('SubmissionView', () => {
  // Keycloak never runs here, so the init lifecycle is driven directly: nothing is read until it
  // has answered.
  function initAnswered() {
    store.dispatch({ type: initKeycloak.pending.type });
    store.dispatch({ type: initKeycloak.fulfilled.type, payload: { authenticated: false } });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    store = makeStore();
    getSubmitSubmission.mockResolvedValue({
      id: 'sub-1',
      formId: 'f1',
      formName: 'Form One',
      versionNo: 3,
      workflowState: 'submitted',
      submittedAt: new Date('2026-01-02T03:04:05Z').toISOString(),
      confirmationCode: 'K7M2Q9XA',
    });
    getSubmitSubmissionSchema.mockResolvedValue({ components: [] });
    getSubmitSubmissionData.mockResolvedValue({ data: { field: 'value' } });
  });

  // A public-audience submission is readable without signing in, so the read must go out with no
  // token rather than waiting for one.
  it('renders for an anonymous reader', async () => {
    initAnswered();
    await renderView();
    await waitFor(() => expect(screen.getByTestId('submission-view-form')).toBeInTheDocument());
    expect(getSubmitSubmission).toHaveBeenCalledWith(undefined, 'sub-1');
    expect(screen.getByTestId('submission-view-version')).toHaveTextContent('v3');
    expect(screen.getByTestId('submission-view-confirmation')).toHaveTextContent(
      'Confirmation ID: K7M2Q9XA',
    );
    expect(screen.queryByTestId('submission-view-submitter')).not.toBeInTheDocument();
  });

  it('shows the review as its submitter is told it, with nothing to continue', async () => {
    initAnswered();
    getSubmitSubmission.mockResolvedValue({
      ...(await getSubmitSubmission()),
      reviewLabel: 'completed',
    });
    await renderView();

    expect(await screen.findByTestId('submission-view-status')).toHaveTextContent('Completed');
    expect(screen.queryByTestId('submission-view-continue')).not.toBeInTheDocument();
  });

  it('links a submitter asked to revise back to the form', async () => {
    initAnswered();
    getSubmitSubmission.mockResolvedValue({
      ...(await getSubmitSubmission()),
      workflowState: 'revising',
      reviewLabel: 'revisionRequested',
      canContinue: true,
    });
    await renderView();

    expect(await screen.findByTestId('submission-view-status')).toHaveTextContent(
      'Revision requested',
    );
    await act(async () => screen.getByTestId('submission-view-continue').click());

    expect(push).toHaveBeenCalledWith('/en/submit/sub-1');
  });

  it('offers no way to continue to someone who may no longer write it', async () => {
    initAnswered();
    getSubmitSubmission.mockResolvedValue({
      ...(await getSubmitSubmission()),
      workflowState: 'revising',
      reviewLabel: 'revisionRequested',
      canContinue: false,
    });
    await renderView();

    await screen.findByTestId('submission-view-status');
    expect(screen.queryByTestId('submission-view-continue')).not.toBeInTheDocument();
  });

  it('shows no confirmation line for a submission without a code', async () => {
    initAnswered();
    getSubmitSubmission.mockResolvedValue({
      id: 'sub-1',
      formId: 'f1',
      workflowState: 'draft',
      confirmationCode: null,
    });
    await renderView();
    await waitFor(() => expect(screen.getByTestId('submission-view-form')).toBeInTheDocument());
    expect(screen.queryByTestId('submission-view-confirmation')).not.toBeInTheDocument();
  });

  it('renders the completed submission below the success confirmation', async () => {
    initAnswered();
    const schema = {
      components: [{ type: 'textfield', key: 'fullName', label: 'Full name', input: true }],
    };
    const answers = { fullName: 'Taylor Smith' };
    getSubmitSubmissionSchema.mockResolvedValue(schema);
    getSubmitSubmissionData.mockResolvedValue({ data: answers });

    await renderView(true);

    const form = await screen.findByTestId('submission-view-form');
    const confirmation = screen.getByText('Keep this ID.');
    expect(screen.getByTestId('submission-success')).toHaveTextContent('Submitted successfully.');
    expect(screen.getByText('K7M2Q9XA').tagName).toBe('STRONG');
    expect(confirmation.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(vi.mocked(ReadOnlyFormView).mock.lastCall?.[0]).toEqual(
      expect.objectContaining({ schema, submission: { data: answers } }),
    );
    expect(getSubmitSubmissionSchema).toHaveBeenCalledWith(undefined, 'sub-1');
    expect(getSubmitSubmissionData).toHaveBeenCalledWith(undefined, 'sub-1');
  });

  it('links a signed-in submitter to their submissions', async () => {
    initAnswered();
    store.dispatch(setToken('token'));
    store.dispatch(setAuthenticated(true));
    await renderView(true);

    const link = await screen.findByTestId('submission-success-my-submissions');
    await act(async () => link.click());

    expect(push).toHaveBeenCalledWith('/en/my-submissions');
  });

  it('offers no submissions link to an anonymous submitter', async () => {
    initAnswered();
    await renderView(true);
    await screen.findByTestId('submission-success');
    expect(screen.queryByTestId('submission-success-my-submissions')).not.toBeInTheDocument();
  });

  it('does not claim success for an unsubmitted form', async () => {
    initAnswered();
    getSubmitSubmission.mockResolvedValue({ id: 'sub-1', workflowState: 'draft' });
    await renderView(true);
    expect(await screen.findByText('Not submitted yet.')).toBeInTheDocument();
    expect(screen.queryByTestId('submission-success')).not.toBeInTheDocument();
  });

  it('sends the token when signed in', async () => {
    initAnswered();
    store.dispatch(setToken('token'));
    store.dispatch(setAuthenticated(true));
    await renderView();
    await waitFor(() => expect(getSubmitSubmission).toHaveBeenCalledWith('token', 'sub-1'));
  });

  it('says not found when the submission does not resolve', async () => {
    initAnswered();
    getSubmitSubmission.mockRejectedValue(new ApiError('Submission not found', 404));
    await renderView();
    await waitFor(() => expect(screen.getByTestId('submission-view-notfound')).toBeInTheDocument());
  });

  it('reports a server failure as a failed load, not a missing submission', async () => {
    initAnswered();
    getSubmitSubmissionData.mockRejectedValue(new ApiError('Request failed (500)', 500));
    await renderView();
    await waitFor(() =>
      expect(screen.getByTestId('submission-view-loaderror')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('submission-view-notfound')).not.toBeInTheDocument();
  });

  // An ended session is not a missing submission; saying "not found" hides why.
  it('distinguishes an ended session from a missing submission', async () => {
    const expired = new Error('Session expired');
    expired.name = 'SessionExpiredError';
    initAnswered();
    getSubmitSubmission.mockRejectedValue(expired);
    await renderView();
    await waitFor(() =>
      expect(screen.getByTestId('submission-view-session-expired')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('submission-view-notfound')).not.toBeInTheDocument();
  });

  // Before Keycloak answers, "no token" is the default rather than an answer. Reading there sends a
  // signed-in visitor's request anonymously, and the confirmation can be refused.
  it('reads nothing until Keycloak has answered', async () => {
    await renderView();
    expect(getSubmitSubmission).not.toHaveBeenCalled();
    expect(screen.queryByTestId('submission-view-notfound')).not.toBeInTheDocument();
  });

  // One cache entry for both identities serves a signed-in reader whatever the anonymous one was
  // allowed to see.
  it('does not serve the anonymous copy after signing in', async () => {
    initAnswered();
    getSubmitSubmission.mockImplementation((token: string | undefined) =>
      Promise.resolve({
        id: 'sub-1',
        formId: 'f1',
        formName: token ? 'Signed in view' : 'Anonymous view',
        versionNo: 3,
        workflowState: 'submitted',
      }),
    );

    const view = await renderView();
    await waitFor(() => expect(screen.getByText('Anonymous view')).toBeInTheDocument());

    store.dispatch(setToken('token'));
    store.dispatch(setAuthenticated(true));
    await act(async () => {
      view.rerender(viewTree());
    });

    await waitFor(() => expect(screen.getByText('Signed in view')).toBeInTheDocument());
    expect(getSubmitSubmission).toHaveBeenCalledWith('token', 'sub-1');
  });
});
