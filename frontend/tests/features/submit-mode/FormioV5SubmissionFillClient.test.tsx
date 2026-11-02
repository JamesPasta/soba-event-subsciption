import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { SWRConfig, useSWRConfig } from 'swr';

const h = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  getSubmitFillBundle: vi.fn(),
  saveSobaFormSubmission: vi.fn(),
  submitSobaFormSubmission: vi.fn(),
  formData: {} as Record<string, unknown>,
  instance: {
    emit: vi.fn(),
    submit: vi.fn(),
    setSubmission: vi.fn(),
    get submission() {
      return { data: h.formData };
    },
  },
  onSubmit: undefined as
    | undefined
    | ((submission: { data: Record<string, unknown> }) => Promise<void>),
  options: undefined as undefined | { readOnly?: boolean; bcgovFile?: unknown },
  submission: undefined as unknown,
  mounts: 0,
  access: { caller: { idpCode: 'idir' as string | null }, pending: false },
  files: { option: {} as Record<string, unknown>, ready: true },
  swrMutate: undefined as undefined | ((key: unknown, data: unknown, opts: unknown) => unknown),
}));

vi.mock('@/app/[lang]/Providers', () => ({
  useDictionary: () => ({
    general: { sessionExpired: 'Your session has ended.', noAccess: 'You do not have access.' },
    submission: { notFound: 'Submission not found.', loadError: 'Could not load this submission.' },
    form: { loading: 'Loading...' },
    apiErrors: {
      drafts_disabled: 'Drafts are off for this form.',
      submission_not_found: 'This submission is gone.',
      revision_id_taken: 'Reload and try again.',
      engine_document_missing: 'The saved data is missing.',
    },
    formioV5: {
      formRender: {
        loadError: 'Could not load the form.',
        rendererError: 'The form could not be displayed.',
        submitSuccess: 'Submitted.',
        missingId: 'Missing submission id.',
        readOnly: 'You can view this submission only.',
        saveDraft: 'Save draft',
        savingDraft: 'Saving draft...',
        savedAt: 'Draft saved at {time}',
        notSaved: 'Draft not saved.',
        notConfirmed: 'Draft may not be saved.',
        offline: 'You are offline.',
        heldSave: 'Changed elsewhere; draft not saved.',
        heldSubmit: 'Changed elsewhere; not submitted.',
        reloadLatest: 'Reload latest version',
        saveMine: 'Save my version',
        submitMine: 'Submit my version',
        alreadySubmitted: 'Already submitted.',
        requestFailed: 'The request failed.',
      },
    },
  }),
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ submissionId: 'sub-1' }),
  useRouter: () => ({ replace: h.replace, push: h.push }),
  usePathname: () => '/en/submit/sub-1',
}));

vi.mock('@/src/shared/api/sobaApi', () => ({
  getSubmitFillBundle: (...args: unknown[]) => h.getSubmitFillBundle(...args),
  saveSobaFormSubmission: (...args: unknown[]) => h.saveSobaFormSubmission(...args),
  submitSobaFormSubmission: (...args: unknown[]) => h.submitSobaFormSubmission(...args),
}));

vi.mock('@/src/features/formio-v5/useBcgovFileOption', () => ({
  useBcgovFileOption: () => h.files,
}));

vi.mock('@/src/shared/api/useAccessCaller', () => ({
  useAccessCaller: () => h.access,
}));

vi.mock('@/src/features/formio-v5/ui/DynamicForm', () => {
  // Like @formio/react: onFormReady once, when the webform is built.
  function MockDynamicForm(props: {
    onSubmit: typeof h.onSubmit;
    options: typeof h.options;
    submission: unknown;
    onFormReady?: (instance: unknown) => void;
  }) {
    h.onSubmit = props.onSubmit;
    h.options = props.options;
    h.submission = props.submission;
    const { onFormReady } = props;
    React.useEffect(() => {
      h.mounts += 1;
    }, []);
    React.useEffect(() => {
      onFormReady?.(h.instance);
    }, [onFormReady]);
    return <div data-testid="fill-form">rendered</div>;
  }
  return { DynamicForm: MockDynamicForm };
});

import makeStore from '@/lib/store';
import { clear, setAuthenticated, setToken } from '@/lib/slices/keycloakSlice';
import { getActiveSubmission } from '@/src/features/formio-v5/activeSubmission';
import { ApiError } from '@/src/shared/api/sobaHelpers';
import { NetworkError, SessionExpiredError } from '@/src/shared/api/sobaFetch';
import FormioV5SubmissionFillClient from '@/src/features/formio-v5/ui/FormioV5SubmissionFillClient';
import {
  SubmissionFillForm,
  type FillLabels,
  type FillView,
} from '@/src/features/formio-v5/ui/SubmissionFillForm';
import { answerInit, renderInStore } from './keycloakInit';

let store: ReturnType<typeof makeStore>;

const notices = () => store.getState().notification.notifications.map((n) => n.text);

// What sobaFetch throws when no response came back.
const networkFailure = () => new NetworkError(new TypeError('Failed to fetch'));

// The caller's role and the form's facts; with an IDIR caller these allow writing and draft saves.
const facts = {
  role: 'owner',
  form: {
    id: 'form-1',
    name: 'Permit application',
    workspaceId: 'ws-1',
    workspaceName: 'Roads',
    publishedVersionId: 'ver-1',
    permissions: ['submission_create'],
    audienceMode: 'members',
    audienceIdps: [],
    allowSubmitterDrafts: true,
    allowSubmitterRevision: false,
  },
};

describe('FormioV5SubmissionFillClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store = makeStore();
    h.formData = {};
    h.mounts = 0;
    h.access = { caller: { idpCode: 'idir' }, pending: false };
    h.files = { option: {}, ready: true };
    h.instance.setSubmission.mockResolvedValue(undefined);
    h.getSubmitFillBundle.mockResolvedValue({
      workflowState: 'opened',
      formVersionId: 'ver-1',
      headRevisionId: 'rev-0',
      schema: { components: [] },
      content: null,
      ...facts,
    });
  });

  // Before Keycloak answers, "no token" is the default rather than an answer. Reading there sends a
  // signed-in visitor's request anonymously.
  it('reads nothing until Keycloak has answered', async () => {
    await renderInStore(store, <FormioV5SubmissionFillClient submissionId="sub-1" />);
    expect(h.getSubmitFillBundle).not.toHaveBeenCalled();
    expect(screen.getByRole('progressbar', { name: 'Loading...' })).toBeInTheDocument();
  });

  it('reads once without a token when there is no session', async () => {
    await renderInStore(store, <FormioV5SubmissionFillClient submissionId="sub-1" />);
    await answerInit(store, { authenticated: false });
    await waitFor(() => expect(screen.getByTestId('fill-form')).toBeInTheDocument());
    expect(h.getSubmitFillBundle).toHaveBeenCalledTimes(1);
    expect(h.getSubmitFillBundle).toHaveBeenCalledWith(undefined, 'sub-1');
  });

  it('reads once with the token when signed in', async () => {
    await renderInStore(store, <FormioV5SubmissionFillClient submissionId="sub-1" />);
    await answerInit(store, { authenticated: true, token: 'token' });
    await waitFor(() => expect(screen.getByTestId('fill-form')).toBeInTheDocument());
    expect(h.getSubmitFillBundle).toHaveBeenCalledTimes(1);
    expect(h.getSubmitFillBundle).toHaveBeenCalledWith('token', 'sub-1');
  });

  const renderSignedOut = async () => {
    await renderInStore(store, <FormioV5SubmissionFillClient submissionId="sub-1" />);
    await answerInit(store, { authenticated: false });
  };

  it('renders an editable form when the caller may write', async () => {
    await renderSignedOut();
    await waitFor(() => expect(screen.getByTestId('fill-form')).toBeInTheDocument());
    expect(h.options?.readOnly).toBe(false);
    expect(screen.queryByTestId('submission-fill-readonly')).not.toBeInTheDocument();
  });

  it('renders the form read-only, with a notice, when the caller may only read', async () => {
    h.getSubmitFillBundle.mockResolvedValue({
      workflowState: 'draft',
      formVersionId: 'ver-1',
      headRevisionId: 'rev-1',
      schema: { components: [] },
      content: null,
      ...facts,
      form: { ...facts.form, permissions: [] },
    });
    await renderSignedOut();
    await waitFor(() => expect(screen.getByTestId('fill-form')).toBeInTheDocument());
    expect(h.options?.readOnly).toBe(true);
    expect(screen.getByTestId('submission-fill-readonly')).toHaveTextContent(
      'You can view this submission only.',
    );
  });

  it('waits for the caller before mounting the form', async () => {
    h.access = { caller: { idpCode: null }, pending: true };
    await renderSignedOut();
    await waitFor(() => expect(h.getSubmitFillBundle).toHaveBeenCalled());
    expect(screen.getByRole('progressbar', { name: 'Loading...' })).toBeInTheDocument();
    expect(screen.queryByTestId('fill-form')).not.toBeInTheDocument();
  });

  it('waits for the file limits before mounting the form', async () => {
    h.files = { option: {}, ready: false };
    await renderSignedOut();
    await waitFor(() => expect(h.getSubmitFillBundle).toHaveBeenCalled());
    expect(screen.queryByTestId('fill-form')).not.toBeInTheDocument();
  });

  it('gives Form.io the file limits', async () => {
    const bcgovFile = { blockedExtensions: ['.exe'], fileMaxSize: '25MB' };
    h.files = { option: { bcgovFile }, ready: true };
    await renderSignedOut();
    await waitFor(() => expect(screen.getByTestId('fill-form')).toBeInTheDocument());
    expect(h.options?.bcgovFile).toEqual(bcgovFile);
  });

  // The public caller's roles never count, and a members audience admits no one outside it.
  it('lets a public caller on a members form only view, with no draft save', async () => {
    h.access = { caller: { idpCode: 'public' }, pending: false };
    await renderSignedOut();
    await waitFor(() => expect(screen.getByTestId('fill-form')).toBeInTheDocument());
    expect(h.options?.readOnly).toBe(true);
    expect(screen.queryByTestId('submission-fill-actions')).not.toBeInTheDocument();
  });

  /** Renders under one SWR cache, so a re-render reads the same bundle; exposes SWR's mutate. */
  const renderLive = async (
    session: Parameters<typeof answerInit>[1] = { authenticated: false },
  ) => {
    const cache = new Map();
    function CaptureMutate() {
      h.swrMutate = useSWRConfig().mutate as typeof h.swrMutate;
      return null;
    }
    const tree = () => (
      <Provider store={store}>
        <SWRConfig
          value={{ provider: () => cache, dedupingInterval: 0, shouldRetryOnError: false }}
        >
          <CaptureMutate />
          <FormioV5SubmissionFillClient submissionId="sub-1" />
        </SWRConfig>
      </Provider>
    );
    let view: ReturnType<typeof render> | undefined;
    await act(async () => {
      view = render(tree());
    });
    await answerInit(store, session);
    return { rerender: () => act(async () => view!.rerender(tree())) };
  };

  it('leaves a submitted record for its view without mounting the form', async () => {
    h.getSubmitFillBundle.mockResolvedValue({
      workflowState: 'submitted',
      formVersionId: 'ver-1',
      headRevisionId: 'rev-3',
      schema: { components: [] },
      content: null,
      ...facts,
    });
    await renderSignedOut();
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith('/en/submission/sub-1'));
    expect(screen.queryByTestId('fill-form')).not.toBeInTheDocument();
  });

  // A reviewer sent it back, so its submitters edit it again rather than view it.
  it('mounts an editable form for a submission sent back to revise', async () => {
    h.getSubmitFillBundle.mockResolvedValue({
      workflowState: 'revising',
      formVersionId: 'ver-1',
      headRevisionId: 'rev-3',
      schema: { components: [] },
      content: { data: { a: 1 } },
      ...facts,
    });
    await renderSignedOut();
    await waitFor(() => expect(screen.getByTestId('fill-form')).toBeInTheDocument());
    expect(h.options?.readOnly).toBe(false);
    expect(h.replace).not.toHaveBeenCalled();
  });

  it('does not remount the form when the bundle refreshes in the background', async () => {
    await renderLive();
    await waitFor(() => expect(screen.getByTestId('fill-form')).toBeInTheDocument());
    await act(async () => {
      await h.swrMutate!(
        (key: unknown) => Array.isArray(key) && key[0] === 'submit-fill',
        {
          workflowState: 'draft',
          formVersionId: 'ver-1',
          headRevisionId: 'rev-7',
          schema: { components: [] },
          content: { data: { a: 9 } },
          ...facts,
        },
        { revalidate: false },
      );
    });
    expect(h.mounts).toBe(1);
    expect(h.instance.setSubmission).toHaveBeenCalledTimes(1);
  });

  it('mounts the form once the caller is known, with its decision', async () => {
    h.access = { caller: { idpCode: null }, pending: true };
    const live = await renderLive();
    await waitFor(() => expect(h.getSubmitFillBundle).toHaveBeenCalled());
    expect(screen.queryByTestId('fill-form')).not.toBeInTheDocument();
    h.access = { caller: { idpCode: 'public' }, pending: false };
    await live.rerender();
    await waitFor(() => expect(screen.getByTestId('fill-form')).toBeInTheDocument());
    expect(h.options?.readOnly).toBe(true);
  });

  // An audience-only form: no role, an IDIR audience.
  it('mounts a writable form when the caller provider arrives after a failed /me', async () => {
    h.getSubmitFillBundle.mockResolvedValue({
      workflowState: 'draft',
      formVersionId: 'ver-1',
      headRevisionId: 'rev-1',
      schema: { components: [] },
      content: null,
      ...facts,
      form: { ...facts.form, permissions: [], audienceMode: 'protected', audienceIdps: ['idir'] },
    });
    h.access = { caller: { idpCode: null }, pending: false };
    const live = await renderLive();
    await waitFor(() => expect(screen.getByTestId('fill-form')).toBeInTheDocument());
    expect(h.options?.readOnly).toBe(true);
    h.access = { caller: { idpCode: 'idir' }, pending: false };
    await live.rerender();
    await waitFor(() => expect(h.mounts).toBe(2));
    expect(h.options?.readOnly).toBe(false);
    expect(screen.getByTestId('submission-fill-save-draft')).toBeInTheDocument();
  });

  it('keeps the form writable when a later decision is narrower', async () => {
    const live = await renderLive();
    await waitFor(() => expect(screen.getByTestId('fill-form')).toBeInTheDocument());
    h.access = { caller: { idpCode: 'public' }, pending: false };
    await live.rerender();
    expect(h.mounts).toBe(1);
    expect(h.options?.readOnly).toBe(false);
  });

  describe('when the session ends', () => {
    const renderSignedIn = async () => {
      const live = await renderLive({ authenticated: true, token: 'token' });
      await waitFor(() => expect(screen.getByTestId('submission-fill-save-draft')).toBeEnabled());
      return live;
    };
    // What a rejected refresh leaves: no token, the public caller, and the Header's sweep of every
    // read, which empties each one and reads it again.
    const endSession = async () => {
      h.access = { caller: { idpCode: 'public' }, pending: false };
      await act(async () => {
        store.dispatch(clear());
      });
      await act(async () => {
        await h.swrMutate!(() => true, undefined, { revalidate: true });
      });
    };

    it('keeps the form mounted and writable, and reads nothing anonymously', async () => {
      await renderSignedIn();
      await endSession();
      expect(screen.getByTestId('fill-form')).toBeInTheDocument();
      expect(h.mounts).toBe(1);
      expect(h.options?.readOnly).toBe(false);
      expect(screen.queryByTestId('submission-view-session-expired')).not.toBeInTheDocument();
      expect(h.getSubmitFillBundle.mock.calls).toEqual([['token', 'sub-1']]);
    });

    it('says the draft was not saved because the session ended', async () => {
      await renderSignedIn();
      await endSession();
      await userEvent.click(screen.getByTestId('submission-fill-save-draft'));
      await waitFor(() =>
        expect(screen.getByTestId('submission-fill-save-status')).toHaveTextContent(
          'Draft not saved. Your session has ended.',
        ),
      );
      expect(h.saveSobaFormSubmission).not.toHaveBeenCalled();
    });

    it('shows the ended session when the filler reloads after it', async () => {
      h.saveSobaFormSubmission.mockResolvedValue({
        headRevisionId: 'rev-head',
        revision: { id: 'rev-x', revisionNo: 1, status: 'pending', reason: 'conflict' },
      });
      await renderSignedIn();
      await userEvent.click(screen.getByTestId('submission-fill-save-draft'));
      await waitFor(() => expect(screen.getByTestId('submission-fill-held')).toBeInTheDocument());
      await endSession();
      await userEvent.click(screen.getByTestId('submission-fill-reload-latest'));
      await waitFor(() =>
        expect(screen.getByTestId('submission-view-session-expired')).toBeInTheDocument(),
      );
      expect(screen.queryByTestId('fill-form')).not.toBeInTheDocument();
      expect(h.getSubmitFillBundle).toHaveBeenCalledTimes(1);
    });
  });

  it('shows the translated no-access message when the read is refused', async () => {
    h.getSubmitFillBundle.mockRejectedValue(
      new ApiError('Not authorized to access this submission', 403),
    );
    await renderSignedOut();
    await waitFor(() =>
      expect(screen.getByTestId('submission-view-noaccess')).toHaveTextContent(
        'You do not have access.',
      ),
    );
    expect(screen.queryByText('Not authorized to access this submission')).not.toBeInTheDocument();
  });

  it.each([
    [
      'the message for its code',
      new ApiError('Form engine document is missing', 500, 'engine_document_missing'),
      'The saved data is missing.',
    ],
    [
      'the load message without a code',
      new ApiError('Internal server error', 500),
      'Could not load this submission.',
    ],
  ])('shows %s when the load fails', async (_label, failure, text) => {
    h.getSubmitFillBundle.mockRejectedValue(failure);
    await renderSignedOut();
    await waitFor(() =>
      expect(screen.getByTestId('submission-view-loaderror')).toHaveTextContent(text),
    );
  });

  describe('submit', () => {
    const renderReady = async () => {
      await renderInStore(store, <FormioV5SubmissionFillClient submissionId="sub-1" />);
      await answerInit(store, { authenticated: false });
      await waitFor(() => expect(screen.getByTestId('fill-form')).toBeInTheDocument());
    };
    const submit = (data: Record<string, unknown>) => act(() => h.onSubmit!({ data }));
    const sentBody = (call: number) =>
      h.submitSobaFormSubmission.mock.calls[call][2] as {
        revisionId: string;
        baseRevisionId: string;
      };
    const writeResponse = (status: 'current' | 'pending', reason = 'accepted') => ({
      revision: { id: 'r-1', revisionNo: 1, status, reason },
    });

    it('sends a new revision id based on the loaded head', async () => {
      h.submitSobaFormSubmission.mockResolvedValue(writeResponse('current'));
      await renderReady();
      await submit({ a: 1 });
      expect(h.submitSobaFormSubmission).toHaveBeenCalledWith(undefined, 'sub-1', {
        data: { a: 1 },
        revisionId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-7/),
        baseRevisionId: 'rev-0',
      });
    });

    it('never submits without a loaded head', async () => {
      h.getSubmitFillBundle.mockResolvedValue({
        workflowState: 'opened',
        formVersionId: 'ver-1',
        headRevisionId: null,
        schema: { components: [] },
        content: null,
        ...facts,
      });
      await renderReady();
      await submit({ a: 1 });
      expect(h.submitSobaFormSubmission).not.toHaveBeenCalled();
      expect(h.instance.emit).toHaveBeenCalledWith('submitError', '');
      expect(screen.getByText('Could not load the form.')).toBeInTheDocument();
    });

    it('reuses the revision id when unchanged answers are resubmitted after a failure', async () => {
      h.submitSobaFormSubmission.mockRejectedValueOnce(networkFailure());
      h.submitSobaFormSubmission.mockResolvedValue(writeResponse('current'));
      await renderReady();
      await submit({ a: 1 });
      await submit({ a: 1 });
      expect(sentBody(1).revisionId).toBe(sentBody(0).revisionId);
    });

    it('mints a new revision id when the answers change', async () => {
      h.submitSobaFormSubmission.mockRejectedValueOnce(networkFailure());
      h.submitSobaFormSubmission.mockResolvedValue(writeResponse('current'));
      await renderReady();
      await submit({ a: 1 });
      await submit({ a: 2 });
      expect(sentBody(1).revisionId).not.toBe(sentBody(0).revisionId);
      expect(sentBody(1).baseRevisionId).toBe('rev-0');
    });

    it('shows the offline message, and releases the button, when the submit never left', async () => {
      h.submitSobaFormSubmission.mockRejectedValue(networkFailure());
      await renderReady();
      await submit({ a: 1 });
      expect(screen.getByTestId('submission-fill-render-error')).toHaveTextContent(
        'You are offline.',
      );
      expect(h.instance.emit).toHaveBeenCalledWith(
        'submitError',
        'The form could not be displayed.',
      );
      expect(h.replace).not.toHaveBeenCalled();
    });

    it('replaces the fill page with the confirmation when the submit becomes current', async () => {
      h.submitSobaFormSubmission.mockResolvedValue(writeResponse('current'));
      await renderReady();
      await submit({ a: 1 });
      expect(h.replace).toHaveBeenCalledWith('/en/submission/sub-1/success');
      expect(h.push).not.toHaveBeenCalled();
    });

    it('stays on the form with the held notice when the submit conflicts', async () => {
      h.submitSobaFormSubmission.mockResolvedValue(writeResponse('pending', 'conflict'));
      await renderReady();
      await submit({ a: 1 });
      expect(h.replace).not.toHaveBeenCalled();
      expect(screen.getByTestId('fill-form')).toBeInTheDocument();
      expect(screen.getByTestId('submission-fill-held')).toHaveTextContent(
        'Changed elsewhere; not submitted.',
      );
      expect(screen.getByTestId('submission-fill-write-mine')).toHaveTextContent(
        'Submit my version',
      );
      expect(h.instance.emit).toHaveBeenCalledWith('submitError', '');
      expect(h.instance.emit).not.toHaveBeenCalledWith('submitDone');
    });

    it('refuses another submit while the held notice shows', async () => {
      h.submitSobaFormSubmission.mockResolvedValue(writeResponse('pending', 'conflict'));
      await renderReady();
      await submit({ a: 1 });
      h.instance.emit.mockClear();
      await submit({ a: 1 });
      expect(h.submitSobaFormSubmission).toHaveBeenCalledTimes(1);
      expect(h.instance.emit).toHaveBeenCalledWith('submitError', '');
    });

    it('submits over the latest version through Form.io when the filler keeps theirs', async () => {
      h.submitSobaFormSubmission.mockResolvedValue(writeResponse('pending', 'conflict'));
      await renderReady();
      await submit({ a: 1 });
      h.getSubmitFillBundle.mockResolvedValueOnce({
        workflowState: 'draft',
        formVersionId: 'ver-1',
        headRevisionId: 'rev-9',
        schema: { components: [] },
        content: null,
        ...facts,
      });
      await userEvent.click(screen.getByTestId('submission-fill-write-mine'));
      await waitFor(() => expect(h.instance.submit).toHaveBeenCalled());
      expect(screen.queryByTestId('submission-fill-held')).not.toBeInTheDocument();
      h.submitSobaFormSubmission.mockResolvedValue(writeResponse('current'));
      await submit({ a: 1 });
      expect(sentBody(1).baseRevisionId).toBe('rev-9');
      expect(sentBody(1).revisionId).not.toBe(sentBody(0).revisionId);
    });

    it('redirects to the submission view when the record was already submitted', async () => {
      h.submitSobaFormSubmission.mockResolvedValue(writeResponse('pending', 'closed'));
      await renderReady();
      await submit({ a: 1 });
      expect(h.replace).toHaveBeenCalledWith('/en/submission/sub-1');
      expect(h.replace).not.toHaveBeenCalledWith('/en/submission/sub-1/success');
    });
  });

  describe('save draft', () => {
    const bundle = (overrides: Record<string, unknown> = {}) => ({
      workflowState: 'draft',
      formVersionId: 'ver-1',
      headRevisionId: 'rev-0',
      schema: { components: [] },
      content: null,
      ...facts,
      ...overrides,
    });
    const renderReady = async () => {
      await renderInStore(store, <FormioV5SubmissionFillClient submissionId="sub-1" />);
      await answerInit(store, { authenticated: false });
      await waitFor(() => expect(screen.getByTestId('fill-form')).toBeInTheDocument());
    };
    const saveButton = () => screen.getByTestId('submission-fill-save-draft');
    const renderLoaded = async () => {
      await renderReady();
      await waitFor(() => expect(saveButton()).toBeEnabled());
    };
    const saveDraft = () => userEvent.click(saveButton());
    const saveStatus = () => screen.getByTestId('submission-fill-save-status');
    const savedBody = (call: number) =>
      h.saveSobaFormSubmission.mock.calls[call][2] as {
        data: Record<string, unknown>;
        revisionId: string;
        baseRevisionId: string;
      };
    // A write that became current is the head; a held one leaves the head where it was.
    const saveResponse = (id: string, status = 'current', reason = 'accepted') => ({
      headRevisionId: status === 'current' ? id : 'rev-head',
      revision: { id, revisionNo: 1, status, reason },
    });

    beforeEach(() => {
      h.getSubmitFillBundle.mockResolvedValue(bundle());
    });

    it('shows no save action when the form does not accept drafts', async () => {
      h.getSubmitFillBundle.mockResolvedValue(
        bundle({ form: { ...facts.form, allowSubmitterDrafts: false } }),
      );
      await renderReady();
      expect(screen.queryByTestId('submission-fill-actions')).not.toBeInTheDocument();
    });

    it('keeps Save draft disabled, and sends nothing, until the loaded answers are in the form', async () => {
      let applied: (value?: unknown) => void = () => undefined;
      h.instance.setSubmission.mockReturnValue(
        new Promise((resolve) => {
          applied = resolve;
        }),
      );
      h.getSubmitFillBundle.mockResolvedValue(bundle({ content: { data: { a: 1 } } }));
      await renderReady();
      expect(h.instance.setSubmission).toHaveBeenCalledWith({ data: { a: 1 } });
      expect(saveButton()).toBeDisabled();
      await saveDraft();
      expect(h.saveSobaFormSubmission).not.toHaveBeenCalled();
      await act(async () => applied());
      expect(saveButton()).toBeEnabled();
    });

    it('saves the current answers based on the loaded head', async () => {
      h.saveSobaFormSubmission.mockResolvedValue(saveResponse('rev-1'));
      h.formData = { a: 1 };
      await renderLoaded();
      await saveDraft();
      await waitFor(() => expect(h.saveSobaFormSubmission).toHaveBeenCalledTimes(1));
      expect(savedBody(0)).toEqual({
        data: { a: 1 },
        revisionId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-7/),
        baseRevisionId: 'rev-0',
      });
    });

    it('reports the save in the status line, with the time it landed', async () => {
      const clicked = new Date('2026-10-12T21:42:00Z');
      const landed = new Date('2026-10-12T21:47:00Z');
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(clicked);
      try {
        h.saveSobaFormSubmission.mockImplementation(async () => {
          vi.setSystemTime(landed);
          return saveResponse('rev-1');
        });
        await renderLoaded();
        expect(saveStatus().textContent).toBe('');
        await saveDraft();
        const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
        await waitFor(() =>
          expect(saveStatus().textContent).toBe(`Draft saved at ${time.format(landed)}`),
        );
        expect(notices()).toEqual([]);
      } finally {
        vi.useRealTimers();
      }
    });

    it('says the draft is saving in the status line, with the button label unchanged', async () => {
      h.saveSobaFormSubmission.mockReturnValue(new Promise(() => undefined));
      await renderLoaded();
      await saveDraft();
      expect(saveStatus()).toHaveTextContent('Saving draft...');
      expect(saveButton()).toHaveTextContent('Save draft');
      expect(saveButton()).toBeDisabled();
    });

    it('says the draft was not saved when the save is held', async () => {
      h.saveSobaFormSubmission.mockResolvedValue(saveResponse('rev-x', 'pending', 'conflict'));
      await renderLoaded();
      await saveDraft();
      await waitFor(() => expect(saveStatus().textContent).toBe('Draft not saved.'));
    });

    it('replays the save id after a submit that also got no response', async () => {
      h.saveSobaFormSubmission.mockRejectedValueOnce(networkFailure());
      h.submitSobaFormSubmission.mockRejectedValueOnce(networkFailure());
      h.saveSobaFormSubmission.mockResolvedValue(saveResponse('rev-1'));
      h.formData = { a: 1 };
      await renderLoaded();
      await saveDraft();
      await waitFor(() => expect(h.saveSobaFormSubmission).toHaveBeenCalledTimes(1));
      await act(() => h.onSubmit!({ data: { a: 1 } }));
      expect(h.submitSobaFormSubmission).toHaveBeenCalledTimes(1);
      const submitted = h.submitSobaFormSubmission.mock.calls[0][2] as { revisionId: string };
      expect(submitted.revisionId).not.toBe(savedBody(0).revisionId);
      await saveDraft();
      await waitFor(() => expect(h.saveSobaFormSubmission).toHaveBeenCalledTimes(2));
      expect(savedBody(1).revisionId).toBe(savedBody(0).revisionId);
    });

    it('bases the next save and the submit on the revision the save produced', async () => {
      h.saveSobaFormSubmission.mockResolvedValue(saveResponse('rev-1'));
      h.submitSobaFormSubmission.mockResolvedValue(saveResponse('rev-2'));
      h.formData = { a: 1 };
      await renderLoaded();
      await saveDraft();
      await waitFor(() => expect(h.saveSobaFormSubmission).toHaveBeenCalledTimes(1));
      h.formData = { a: 2 };
      await saveDraft();
      await waitFor(() => expect(h.saveSobaFormSubmission).toHaveBeenCalledTimes(2));
      expect(savedBody(1).baseRevisionId).toBe('rev-1');
      await act(() => h.onSubmit!({ data: { a: 2 } }));
      expect(h.submitSobaFormSubmission.mock.calls[0][2]).toMatchObject({
        baseRevisionId: 'rev-1',
      });
    });

    it('mints a new revision id for an unchanged save after a successful one', async () => {
      h.saveSobaFormSubmission.mockResolvedValue(saveResponse('rev-1'));
      h.formData = { a: 1 };
      await renderLoaded();
      await saveDraft();
      await waitFor(() => expect(h.saveSobaFormSubmission).toHaveBeenCalledTimes(1));
      await saveDraft();
      await waitFor(() => expect(h.saveSobaFormSubmission).toHaveBeenCalledTimes(2));
      expect(savedBody(1).revisionId).not.toBe(savedBody(0).revisionId);
    });

    it('reuses the revision id when an unchanged save is retried after a failure', async () => {
      h.saveSobaFormSubmission.mockRejectedValueOnce(networkFailure());
      h.saveSobaFormSubmission.mockResolvedValue(saveResponse('rev-1'));
      h.formData = { a: 1 };
      await renderLoaded();
      await saveDraft();
      await waitFor(() => expect(h.saveSobaFormSubmission).toHaveBeenCalledTimes(1));
      await saveDraft();
      await waitFor(() => expect(h.saveSobaFormSubmission).toHaveBeenCalledTimes(2));
      expect(savedBody(1).revisionId).toBe(savedBody(0).revisionId);
    });

    it('reuses the revision id when an unchanged save is retried after a server failure', async () => {
      h.saveSobaFormSubmission.mockRejectedValueOnce(new ApiError('Gateway timeout', 504));
      h.saveSobaFormSubmission.mockResolvedValue(saveResponse('rev-1'));
      h.formData = { a: 1 };
      await renderLoaded();
      await saveDraft();
      await waitFor(() => expect(h.saveSobaFormSubmission).toHaveBeenCalledTimes(1));
      await saveDraft();
      await waitFor(() => expect(h.saveSobaFormSubmission).toHaveBeenCalledTimes(2));
      expect(savedBody(1).revisionId).toBe(savedBody(0).revisionId);
    });

    it('mints a new revision id when an unchanged save is retried after a refusal', async () => {
      h.saveSobaFormSubmission.mockRejectedValueOnce(
        new ApiError('Revision id already used by another write', 409, 'revision_id_taken'),
      );
      h.saveSobaFormSubmission.mockResolvedValue(saveResponse('rev-1'));
      h.formData = { a: 1 };
      await renderLoaded();
      await saveDraft();
      await waitFor(() => expect(h.saveSobaFormSubmission).toHaveBeenCalledTimes(1));
      await saveDraft();
      await waitFor(() => expect(h.saveSobaFormSubmission).toHaveBeenCalledTimes(2));
      expect(savedBody(1).revisionId).not.toBe(savedBody(0).revisionId);
    });

    it('holds a replayed save that another save has since replaced, and keeps its base', async () => {
      h.saveSobaFormSubmission.mockResolvedValueOnce({
        ...saveResponse('rev-1'),
        headRevisionId: 'rev-9',
      });
      h.submitSobaFormSubmission.mockResolvedValue(saveResponse('rev-10'));
      await renderLoaded();
      await saveDraft();
      await waitFor(() =>
        expect(screen.getByTestId('submission-fill-held')).toHaveTextContent(
          'Changed elsewhere; draft not saved.',
        ),
      );
      expect(saveStatus().textContent).toBe('Draft not saved.');
      h.getSubmitFillBundle.mockResolvedValueOnce(bundle({ headRevisionId: 'rev-9' }));
      h.saveSobaFormSubmission.mockResolvedValue(saveResponse('rev-11'));
      await userEvent.click(screen.getByTestId('submission-fill-write-mine'));
      await waitFor(() => expect(h.saveSobaFormSubmission).toHaveBeenCalledTimes(2));
      expect(savedBody(1).baseRevisionId).toBe('rev-9');
    });

    it('leaves for the submission view when a replayed save finds the record submitted', async () => {
      h.saveSobaFormSubmission.mockResolvedValue({
        ...saveResponse('rev-1'),
        workflowState: 'submitted',
      });
      await renderLoaded();
      await saveDraft();
      await waitFor(() => expect(h.replace).toHaveBeenCalledWith('/en/submission/sub-1'));
      expect(notices()).toEqual(['Already submitted.']);
    });

    it('does not reload the form after a save', async () => {
      h.saveSobaFormSubmission.mockResolvedValue(saveResponse('rev-1'));
      await renderLoaded();
      await saveDraft();
      await waitFor(() => expect(h.saveSobaFormSubmission).toHaveBeenCalledTimes(1));
      expect(h.getSubmitFillBundle).toHaveBeenCalledTimes(1);
    });

    it.each([
      [
        'the message for its code',
        new ApiError('Drafts are not enabled for this form', 403, 'drafts_disabled'),
        'Draft not saved. Drafts are off for this form.',
      ],
      [
        'the message for a submission deleted meanwhile',
        new ApiError('Submission not found', 404, 'submission_not_found'),
        'Draft not saved. This submission is gone.',
      ],
      [
        'the message for a revision id another write used',
        new ApiError('Revision id already used by another write', 409, 'revision_id_taken'),
        'Draft not saved. Reload and try again.',
      ],
      [
        'that a save the server failed on may have landed',
        new ApiError('Internal server error', 500),
        'Draft may not be saved. The request failed.',
      ],
      [
        'that a save with no response may have landed',
        networkFailure(),
        'Draft may not be saved. You are offline.',
      ],
      [
        'the ended session message',
        new SessionExpiredError(),
        'Draft not saved. Your session has ended.',
      ],
      [
        'the generic message, not the offline one, for an error that is not from the API',
        new TypeError('x is undefined'),
        'Draft not saved. The request failed.',
      ],
      [
        'the server text for an uncoded client error',
        new ApiError('Engine rejected the data', 400),
        'Draft not saved. Engine rejected the data',
      ],
    ])('shows %s in the status line when a save fails', async (_label, failure, text) => {
      h.saveSobaFormSubmission.mockRejectedValue(failure);
      await renderLoaded();
      await saveDraft();
      await waitFor(() => expect(saveStatus().textContent).toBe(text));
      expect(screen.queryByTestId('submission-fill-render-error')).not.toBeInTheDocument();
    });

    it('offers to reload or keep the filler version when the save conflicts', async () => {
      h.saveSobaFormSubmission.mockResolvedValue(saveResponse('rev-x', 'pending', 'conflict'));
      await renderLoaded();
      await saveDraft();
      await waitFor(() =>
        expect(screen.getByTestId('submission-fill-held')).toHaveTextContent(
          'Changed elsewhere; draft not saved.',
        ),
      );
      expect(screen.getByTestId('submission-fill-write-mine')).toHaveTextContent('Save my version');
    });

    it('disables Save draft while the held notice shows', async () => {
      h.saveSobaFormSubmission.mockResolvedValue(saveResponse('rev-x', 'pending', 'conflict'));
      await renderLoaded();
      await saveDraft();
      await waitFor(() => expect(screen.getByTestId('submission-fill-held')).toBeInTheDocument());
      expect(screen.getByTestId('submission-fill-save-draft')).toBeDisabled();
    });

    it('refuses a submit that waited on a save which was then held', async () => {
      let finishSave: (value: unknown) => void = () => undefined;
      h.saveSobaFormSubmission.mockReturnValue(
        new Promise((resolve) => {
          finishSave = resolve;
        }),
      );
      await renderLoaded();
      await saveDraft();
      const submitting = act(() => h.onSubmit!({ data: { a: 1 } }));
      finishSave(saveResponse('rev-x', 'pending', 'conflict'));
      await submitting;
      expect(h.submitSobaFormSubmission).not.toHaveBeenCalled();
      expect(screen.getByTestId('submission-fill-held')).toBeInTheDocument();
    });

    it('sends no submit, and leaves once, when the save it waited on finds the record submitted', async () => {
      let finishSave: (value: unknown) => void = () => undefined;
      h.saveSobaFormSubmission.mockReturnValue(
        new Promise((resolve) => {
          finishSave = resolve;
        }),
      );
      await renderLoaded();
      await saveDraft();
      const submitting = act(() => h.onSubmit!({ data: { a: 1 } }));
      finishSave(saveResponse('rev-x', 'pending', 'closed'));
      await submitting;
      expect(h.submitSobaFormSubmission).not.toHaveBeenCalled();
      expect(h.instance.emit).toHaveBeenCalledWith('submitError', '');
      await waitFor(() => expect(h.replace).toHaveBeenCalledWith('/en/submission/sub-1'));
      expect(h.replace).toHaveBeenCalledTimes(1);
      expect(notices()).toEqual(['Already submitted.']);
    });

    it('keeps the message on screen when a submit is refused while a write is held', async () => {
      h.saveSobaFormSubmission.mockResolvedValue(saveResponse('rev-x', 'pending', 'conflict'));
      await renderLoaded();
      await saveDraft();
      await waitFor(() => expect(screen.getByTestId('submission-fill-held')).toBeInTheDocument());
      h.getSubmitFillBundle.mockRejectedValueOnce(new ApiError('Internal server error', 500));
      await userEvent.click(screen.getByTestId('submission-fill-write-mine'));
      await waitFor(() =>
        expect(screen.getByTestId('submission-fill-render-error')).toHaveTextContent(
          'The request failed.',
        ),
      );
      await act(() => h.onSubmit!({ data: { a: 1 } }));
      expect(h.submitSobaFormSubmission).not.toHaveBeenCalled();
      expect(screen.getByTestId('submission-fill-render-error')).toHaveTextContent(
        'The request failed.',
      );
    });

    it('saves over the latest version with a fresh revision id when the filler keeps theirs', async () => {
      h.saveSobaFormSubmission.mockResolvedValueOnce(saveResponse('rev-x', 'pending', 'conflict'));
      h.saveSobaFormSubmission.mockResolvedValue(saveResponse('rev-10'));
      h.formData = { a: 1 };
      await renderLoaded();
      await saveDraft();
      await waitFor(() => expect(screen.getByTestId('submission-fill-held')).toBeInTheDocument());
      h.getSubmitFillBundle.mockResolvedValueOnce(bundle({ headRevisionId: 'rev-9' }));
      await userEvent.click(screen.getByTestId('submission-fill-write-mine'));
      await waitFor(() => expect(h.saveSobaFormSubmission).toHaveBeenCalledTimes(2));
      expect(savedBody(1).baseRevisionId).toBe('rev-9');
      expect(savedBody(1).revisionId).not.toBe(savedBody(0).revisionId);
      expect(screen.queryByTestId('submission-fill-held')).not.toBeInTheDocument();
    });

    it('reloads the latest version when the filler discards theirs', async () => {
      h.saveSobaFormSubmission.mockResolvedValue(saveResponse('rev-x', 'pending', 'conflict'));
      await renderLoaded();
      await saveDraft();
      await waitFor(() => expect(screen.getByTestId('submission-fill-held')).toBeInTheDocument());
      h.getSubmitFillBundle.mockResolvedValue(
        bundle({ headRevisionId: 'rev-9', content: { data: { b: 2 } } }),
      );
      await userEvent.click(screen.getByTestId('submission-fill-reload-latest'));
      await waitFor(() => expect(h.getSubmitFillBundle).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(h.mounts).toBe(2));
      expect(h.instance.setSubmission).toHaveBeenLastCalledWith({ data: { b: 2 } });
      expect(screen.queryByTestId('submission-fill-held')).not.toBeInTheDocument();
      h.saveSobaFormSubmission.mockResolvedValue(saveResponse('rev-10'));
      await saveDraft();
      await waitFor(() => expect(h.saveSobaFormSubmission).toHaveBeenCalledTimes(2));
      expect(savedBody(1).baseRevisionId).toBe('rev-9');
    });

    it('keeps the held notice, and refuses a submit, until the latest version has loaded', async () => {
      h.saveSobaFormSubmission.mockResolvedValue(saveResponse('rev-x', 'pending', 'conflict'));
      await renderLoaded();
      await saveDraft();
      await waitFor(() => expect(screen.getByTestId('submission-fill-held')).toBeInTheDocument());
      h.getSubmitFillBundle.mockReturnValueOnce(new Promise(() => undefined));
      await userEvent.click(screen.getByTestId('submission-fill-reload-latest'));
      await waitFor(() => expect(h.getSubmitFillBundle).toHaveBeenCalledTimes(2));
      await act(() => h.onSubmit!({ data: { a: 1 } }));
      expect(h.submitSobaFormSubmission).not.toHaveBeenCalled();
      expect(screen.getByTestId('submission-fill-held')).toBeInTheDocument();
    });

    it('disables both held actions while one is running', async () => {
      h.saveSobaFormSubmission.mockResolvedValue(saveResponse('rev-x', 'pending', 'conflict'));
      await renderLoaded();
      await saveDraft();
      await waitFor(() => expect(screen.getByTestId('submission-fill-held')).toBeInTheDocument());
      h.getSubmitFillBundle.mockReturnValueOnce(new Promise(() => undefined));
      await userEvent.click(screen.getByTestId('submission-fill-write-mine'));
      await waitFor(() => expect(screen.getByTestId('submission-fill-write-mine')).toBeDisabled());
      expect(screen.getByTestId('submission-fill-reload-latest')).toBeDisabled();
      expect(screen.getByTestId('submission-fill-save-draft')).toBeDisabled();
    });

    it('leaves with a notice when keeping theirs finds the record submitted', async () => {
      h.saveSobaFormSubmission.mockResolvedValue(saveResponse('rev-x', 'pending', 'conflict'));
      await renderLoaded();
      await saveDraft();
      await waitFor(() => expect(screen.getByTestId('submission-fill-held')).toBeInTheDocument());
      h.getSubmitFillBundle.mockResolvedValueOnce(bundle({ workflowState: 'submitted' }));
      await userEvent.click(screen.getByTestId('submission-fill-write-mine'));
      await waitFor(() => expect(h.replace).toHaveBeenCalledWith('/en/submission/sub-1'));
      expect(notices()).toContain('Already submitted.');
    });

    it('keeps the held notice, with the failure, when keeping theirs cannot re-read the head', async () => {
      h.saveSobaFormSubmission.mockResolvedValue(saveResponse('rev-x', 'pending', 'conflict'));
      await renderLoaded();
      await saveDraft();
      await waitFor(() => expect(screen.getByTestId('submission-fill-held')).toBeInTheDocument());
      h.getSubmitFillBundle.mockRejectedValueOnce(new ApiError('Internal server error', 500));
      await userEvent.click(screen.getByTestId('submission-fill-write-mine'));
      await waitFor(() =>
        expect(screen.getByTestId('submission-fill-render-error')).toHaveTextContent(
          'The request failed.',
        ),
      );
      expect(h.saveSobaFormSubmission).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('submission-fill-held')).toBeInTheDocument();
      expect(screen.getByTestId('submission-fill-write-mine')).toBeEnabled();
    });

    it('bases a submit made during a save on the revision that save produces', async () => {
      let finishSave: (value: unknown) => void = () => undefined;
      h.saveSobaFormSubmission.mockReturnValue(
        new Promise((resolve) => {
          finishSave = resolve;
        }),
      );
      h.submitSobaFormSubmission.mockResolvedValue(saveResponse('rev-2'));
      await renderLoaded();
      await saveDraft();
      const submitting = act(() => h.onSubmit!({ data: { a: 1 } }));
      expect(h.submitSobaFormSubmission).not.toHaveBeenCalled();
      finishSave(saveResponse('rev-1'));
      await submitting;
      expect(h.submitSobaFormSubmission.mock.calls[0][2]).toMatchObject({
        baseRevisionId: 'rev-1',
      });
    });

    it('leaves for the submission view when the record was already submitted', async () => {
      h.saveSobaFormSubmission.mockResolvedValue(saveResponse('rev-x', 'pending', 'closed'));
      await renderLoaded();
      await saveDraft();
      await waitFor(() => expect(h.replace).toHaveBeenCalledWith('/en/submission/sub-1'));
    });
  });

  // The SWR cache outlives the page; a later visit must not render the copy read before a save.
  it('reads the bundle again when the page is visited again', async () => {
    const cache = new Map();
    const tree = (show: boolean) => (
      <Provider store={store}>
        <SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}>
          {show ? <FormioV5SubmissionFillClient submissionId="sub-1" /> : null}
        </SWRConfig>
      </Provider>
    );
    let view: ReturnType<typeof render> | undefined;
    await act(async () => {
      view = render(tree(true));
    });
    await answerInit(store, { authenticated: false });
    await waitFor(() => expect(screen.getByTestId('fill-form')).toBeInTheDocument());
    await act(async () => view!.rerender(tree(false)));
    await act(async () => view!.rerender(tree(true)));
    await waitFor(() => expect(h.getSubmitFillBundle).toHaveBeenCalledTimes(2));
  });
});

describe('SubmissionFillForm', () => {
  const view = (data: Record<string, unknown>): FillView => ({
    snapshot: {
      formId: 'form-1',
      workflowState: 'draft',
      formVersionId: 'ver-1',
      headRevisionId: 'rev-1',
      currentRevisionNo: 1,
      schema: { components: [] },
      content: { data },
      ...facts,
    } as FillView['snapshot'],
    canWrite: true,
    canSaveDraft: false,
    fileOption: {},
    signedIn: false,
  });
  const tree = (current: FillView) => (
    <Provider store={store}>
      <SWRConfig value={{ provider: () => new Map() }}>
        <SubmissionFillForm
          submissionId="sub-1"
          submissionPath="/en/submission/sub-1"
          view={current}
          labels={{ errors: {} } as unknown as FillLabels}
          onReload={async () => undefined}
        />
      </SWRConfig>
    </Provider>
  );

  beforeEach(() => {
    vi.clearAllMocks();
    store = makeStore();
    h.mounts = 0;
    h.instance.setSubmission.mockResolvedValue(undefined);
  });

  describe('session', () => {
    const labels = {
      sessionExpired: 'Your session has ended.',
      requestFailed: 'The request failed.',
      rendererError: 'The form could not be displayed.',
      saveDraft: 'Save draft',
      savingDraft: 'Saving draft...',
      savedAt: 'Draft saved at {time}',
      notSaved: 'Draft not saved.',
      notConfirmed: 'Draft may not be saved.',
      offline: 'You are offline.',
      errors: {},
    } as unknown as FillLabels;
    const writable: FillView = { ...view({ a: 1 }), canSaveDraft: true };
    // The page's session: the identity it pinned, which every write goes out as.
    const renderForm = async (signedIn = false) => {
      let rendered: ReturnType<typeof render> | undefined;
      await act(async () => {
        rendered = render(
          <Provider store={store}>
            <SubmissionFillForm
              submissionId="sub-1"
              submissionPath="/en/submission/sub-1"
              view={{ ...writable, signedIn }}
              labels={labels}
              onReload={async () => undefined}
            />
          </Provider>,
        );
      });
      await waitFor(() => expect(screen.getByTestId('submission-fill-save-draft')).toBeEnabled());
      return rendered!;
    };
    const signIn = (token: string | undefined) =>
      act(() => {
        store.dispatch(setAuthenticated(true));
        store.dispatch(setToken(token));
      });
    const saveDraft = () => userEvent.click(screen.getByTestId('submission-fill-save-draft'));

    beforeEach(() => {
      h.formData = { a: 1 };
      h.saveSobaFormSubmission.mockResolvedValue({
        headRevisionId: 'rev-2',
        revision: { id: 'rev-2', revisionNo: 2, status: 'current', reason: 'accepted' },
      });
    });

    it('sends a save with the token the session holds when it is sent', async () => {
      await signIn('token');
      await renderForm(true);
      await act(() => store.dispatch(setToken('token-2')));
      await saveDraft();
      await waitFor(() => expect(h.saveSobaFormSubmission).toHaveBeenCalledTimes(1));
      expect(h.saveSobaFormSubmission.mock.calls[0][0]).toBe('token-2');
    });

    it('never sends a save anonymously for a form mounted signed in', async () => {
      await signIn('token');
      await renderForm(true);
      await act(() => store.dispatch(clear()));
      await saveDraft();
      await waitFor(() =>
        expect(screen.getByTestId('submission-fill-save-status')).toHaveTextContent(
          'Draft not saved. Your session has ended.',
        ),
      );
      expect(h.saveSobaFormSubmission).not.toHaveBeenCalled();
    });

    // The first save re-renders the form, so the second shows what a later render decides.
    it('keeps saving anonymously a form mounted signed out', async () => {
      await renderForm();
      await signIn('token');
      await saveDraft();
      await waitFor(() => expect(h.saveSobaFormSubmission).toHaveBeenCalledTimes(1));
      await saveDraft();
      await waitFor(() => expect(h.saveSobaFormSubmission).toHaveBeenCalledTimes(2));
      expect(h.saveSobaFormSubmission.mock.calls.map(([token]) => token)).toEqual([
        undefined,
        undefined,
      ]);
    });

    it('tells the upload provider which submission is filled, and in which session', async () => {
      await signIn('token');
      const rendered = await renderForm(true);
      expect(getActiveSubmission()).toEqual({ submissionId: 'sub-1', signedIn: true });
      rendered.unmount();
      expect(getActiveSubmission()).toBeNull();
    });
  });

  // A click that mounts a new form blurs the field Form.io had focused, and Form.io runs that blur a
  // moment later, on the webform it has destroyed by then.
  it('cancels the blur Form.io scheduled when the form unmounts', async () => {
    const cancel = vi.fn();
    const instance = h.instance as typeof h.instance & { pendingBlur?: { cancel: () => void } };
    instance.pendingBlur = { cancel };
    try {
      let rendered: ReturnType<typeof render> | undefined;
      await act(async () => {
        rendered = render(tree(view({ a: 1 })));
      });
      expect(cancel).not.toHaveBeenCalled();
      rendered!.unmount();
      expect(cancel).toHaveBeenCalledTimes(1);
    } finally {
      delete instance.pendingBlur;
    }
  });

  it('keeps Form.io on the bundle it mounted with when given a new one', async () => {
    const view1 = view({ a: 1 });
    let rendered: ReturnType<typeof render> | undefined;
    await act(async () => {
      rendered = render(tree(view1));
    });
    expect(h.mounts).toBe(1);
    await act(async () => rendered!.rerender(tree(view({ a: 2 }))));
    expect(h.mounts).toBe(1);
    expect(h.submission).toEqual({ data: { a: 1 } });
    expect(h.instance.setSubmission).toHaveBeenCalledTimes(1);
    expect(h.instance.setSubmission).toHaveBeenCalledWith({ data: { a: 1 } });
  });
});
