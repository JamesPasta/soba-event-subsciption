import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { SWRConfig, useSWRConfig } from 'swr';
import userEvent from '@testing-library/user-event';

const h = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  getSubmitForm: vi.fn(),
  getSubmitFormVersionSchema: vi.fn(),
  openSobaFormSubmission: vi.fn(),
  saveSobaFormSubmission: vi.fn(),
  submitSobaFormSubmission: vi.fn(),
  getSubmitFillBundle: vi.fn(),
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
  form: undefined as unknown,
  submission: undefined as unknown,
  options: undefined as undefined | { readOnly?: boolean },
  mounts: 0,
  access: { caller: { idpCode: 'idir' as string | null }, pending: false },
  pathname: '/en/form/form-1',
  files: { option: {} as Record<string, unknown>, ready: true },
  swrMutate: undefined as undefined | ((key: unknown, data: unknown, opts: unknown) => unknown),
}));

vi.mock('@/app/[lang]/Providers', () => ({
  useDictionary: () => ({
    general: { sessionExpired: 'Your session has ended.', noAccess: 'You do not have access.' },
    form: { loading: 'Loading...' },
    apiErrors: {
      open_denied: 'You are not able to submit this form.',
      not_published: 'This form is not accepting submissions.',
      form_not_found: 'This form could not be found.',
      submission_id_taken: 'Reload the page to start again.',
      version_not_published: 'This version of the form is no longer accepting submissions.',
    },
    formioV5: {
      formRender: {
        loadError: 'Could not load the form.',
        rendererError: 'The form could not be displayed.',
        submitSuccess: 'Submitted.',
        missingId: 'No form was selected.',
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
        formUpdated: 'This form was updated. Your answers are kept.',
        continueUpdated: 'Continue on the updated form',
      },
    },
  }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: h.replace, push: h.push }),
  usePathname: () => h.pathname,
}));

vi.mock('@/src/shared/api/sobaApi', () => ({
  getSubmitForm: (...args: unknown[]) => h.getSubmitForm(...args),
  getSubmitFormVersionSchema: (...args: unknown[]) => h.getSubmitFormVersionSchema(...args),
  openSobaFormSubmission: (...args: unknown[]) => h.openSobaFormSubmission(...args),
  saveSobaFormSubmission: (...args: unknown[]) => h.saveSobaFormSubmission(...args),
  submitSobaFormSubmission: (...args: unknown[]) => h.submitSobaFormSubmission(...args),
  getSubmitFillBundle: (...args: unknown[]) => h.getSubmitFillBundle(...args),
}));

vi.mock('@/src/features/formio-v5/useBcgovFileOption', () => ({
  useBcgovFileOption: () => h.files,
}));

vi.mock('@/src/shared/api/useAccessCaller', () => ({
  useAccessCaller: () => h.access,
}));

vi.mock('@/src/features/formio-v5/ui/DynamicForm', () => {
  function MockDynamicForm(props: {
    form: unknown;
    onSubmit: typeof h.onSubmit;
    options: typeof h.options;
    submission: unknown;
    onFormReady?: (instance: unknown) => void;
  }) {
    h.form = props.form;
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
import { clear } from '@/lib/slices/keycloakSlice';
import {
  openedActiveSubmissionId,
  setActiveSubmission,
} from '@/src/features/formio-v5/activeSubmission';
import { ApiError } from '@/src/shared/api/sobaHelpers';
import { NetworkError } from '@/src/shared/api/sobaFetch';
import FormioV5NewSubmissionClient from '@/src/features/formio-v5/ui/FormioV5NewSubmissionClient';
import { answerInit, renderInStore } from './keycloakInit';

let store: ReturnType<typeof makeStore>;

const form = {
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
};
const schema = { components: [{ key: 'name', type: 'textfield' }] };
const version = (formVersionId: string, schemaHash: string, components = schema) => ({
  formId: 'form-1',
  formVersionId,
  versionNo: Number(formVersionId.slice(-1)),
  schema: components,
  schemaHash,
});
// What the open answers: the submission on its version, its revision 0 the head.
const opened = (id: string, formVersionId = 'ver-1') => ({
  id,
  formId: 'form-1',
  formVersionId,
  workflowState: 'opened',
  headRevisionId: 'rev-0',
});
const written = (id: string, status = 'current') => ({
  headRevisionId: id,
  workflowState: 'draft',
  revision: { id, revisionNo: 1, status, reason: 'accepted' },
});

const saveButton = () => screen.getByTestId('submission-fill-save-draft');
const saveStatus = () => screen.getByTestId('submission-fill-save-status');
const openedId = (call = 0) => h.openSobaFormSubmission.mock.calls[call][2] as string;
const openedOn = (call = 0) => h.openSobaFormSubmission.mock.calls[call][3] as string;
const savedBody = (call = 0) =>
  h.saveSobaFormSubmission.mock.calls[call][2] as { baseRevisionId: string };

const renderPage = async (
  session = { authenticated: false } as Parameters<typeof answerInit>[1],
) => {
  await renderInStore(store, <FormioV5NewSubmissionClient formId="form-1" />);
  await answerInit(store, session);
};
const renderLoaded = async (session?: Parameters<typeof answerInit>[1]) => {
  await renderPage(session);
  await waitFor(() => expect(saveButton()).toBeEnabled());
};
const submit = (data: Record<string, unknown>) => act(() => h.onSubmit!({ data }));

/** Renders under one SWR cache, exposing SWR's mutate, so a test can re-render and unmount. */
const renderTree = async (session: Parameters<typeof answerInit>[1] = { authenticated: false }) => {
  const cache = new Map();
  function CaptureMutate() {
    h.swrMutate = useSWRConfig().mutate as typeof h.swrMutate;
    return null;
  }
  const tree = () => (
    <Provider store={store}>
      <SWRConfig value={{ provider: () => cache, dedupingInterval: 0, shouldRetryOnError: false }}>
        <CaptureMutate />
        <FormioV5NewSubmissionClient formId="form-1" />
      </SWRConfig>
    </Provider>
  );
  let view: ReturnType<typeof render> | undefined;
  await act(async () => {
    view = render(tree());
  });
  await answerInit(store, session);
  return {
    rerender: () => act(async () => view!.rerender(tree())),
    unmount: () => act(async () => view!.unmount()),
  };
};

/** An open that waits until the test lets it land. */
const holdOpen = () => {
  let land: () => void = () => undefined;
  h.openSobaFormSubmission.mockImplementationOnce(
    (_token: unknown, _formId: unknown, id: string) =>
      new Promise((resolve) => {
        land = () => resolve(opened(id));
      }),
  );
  return () => act(async () => land());
};

describe('FormioV5NewSubmissionClient', () => {
  const replaceState = vi.spyOn(globalThis.history, 'replaceState');

  beforeEach(() => {
    vi.clearAllMocks();
    store = makeStore();
    h.formData = { name: 'Ada' };
    h.mounts = 0;
    h.pathname = '/en/form/form-1';
    // The browser is at the start address, as the router reports it.
    globalThis.history.pushState(null, '', '/en/form/form-1');
    h.access = { caller: { idpCode: 'idir' }, pending: false };
    h.files = { option: {}, ready: true };
    h.instance.setSubmission.mockResolvedValue(undefined);
    h.getSubmitForm.mockResolvedValue(form);
    h.getSubmitFormVersionSchema.mockResolvedValue(version('ver-1', 'hash-1'));
    h.openSobaFormSubmission.mockImplementation(
      async (_token: unknown, _formId: unknown, id: string, formVersionId: string) =>
        opened(id, formVersionId),
    );
    h.saveSobaFormSubmission.mockResolvedValue(written('rev-1'));
    h.submitSobaFormSubmission.mockResolvedValue(written('rev-2'));
    replaceState.mockImplementation(() => undefined);
  });

  afterEach(() => {
    replaceState.mockReset();
  });

  it('reads nothing until Keycloak has answered', async () => {
    await renderInStore(store, <FormioV5NewSubmissionClient formId="form-1" />);
    expect(h.getSubmitForm).not.toHaveBeenCalled();
    expect(screen.getByRole('progressbar', { name: 'Loading...' })).toBeInTheDocument();
  });

  it('renders the published version without opening a submission', async () => {
    await renderLoaded();
    expect(h.getSubmitForm).toHaveBeenCalledWith(undefined, 'form-1');
    expect(h.getSubmitFormVersionSchema).toHaveBeenCalledWith(undefined, 'ver-1');
    expect(h.form).toEqual(schema);
    expect(h.options?.readOnly).toBe(false);
    expect(h.openSobaFormSubmission).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('opens on the first save, then saves on the head the open recorded', async () => {
    await renderLoaded();
    await userEvent.click(saveButton());
    await waitFor(() => expect(h.saveSobaFormSubmission).toHaveBeenCalledTimes(1));
    expect(h.openSobaFormSubmission).toHaveBeenCalledWith(
      undefined,
      'form-1',
      expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-7/),
      'ver-1',
    );
    expect(h.saveSobaFormSubmission.mock.calls[0][1]).toBe(openedId());
    expect(savedBody().baseRevisionId).toBe('rev-0');
    // The address becomes the fill page of the submission the open created.
    expect(replaceState).toHaveBeenCalledWith(null, '', `/en/submit/${openedId()}`);
  });

  it('opens on a submit without a save, then submits on the recorded head', async () => {
    await renderLoaded();
    await submit({ name: 'Ada' });
    expect(h.openSobaFormSubmission).toHaveBeenCalledTimes(1);
    expect(h.submitSobaFormSubmission.mock.calls[0][1]).toBe(openedId());
    expect(h.submitSobaFormSubmission.mock.calls[0][2]).toMatchObject({ baseRevisionId: 'rev-0' });
    expect(h.replace).toHaveBeenCalledWith(`/en/submission/${openedId()}/success`);
  });

  it('bases a submit made during the first save on that save, opening once', async () => {
    let finishOpen: (value: unknown) => void = () => undefined;
    h.openSobaFormSubmission.mockImplementationOnce(
      (_token: unknown, _formId: unknown, id: string) =>
        new Promise((resolve) => {
          finishOpen = () => resolve(opened(id));
        }),
    );
    await renderLoaded();
    await userEvent.click(saveButton());
    const submitting = submit({ name: 'Ada' });
    await act(async () => finishOpen(undefined));
    await submitting;
    expect(h.openSobaFormSubmission).toHaveBeenCalledTimes(1);
    expect(savedBody().baseRevisionId).toBe('rev-0');
    expect(h.submitSobaFormSubmission.mock.calls[0][2]).toMatchObject({ baseRevisionId: 'rev-1' });
  });

  it('opens before an upload names the submission, and only once', async () => {
    await renderLoaded();
    let id = '';
    await act(async () => {
      id = await openedActiveSubmissionId();
    });
    expect(h.openSobaFormSubmission).toHaveBeenCalledTimes(1);
    expect(id).toBe(openedId());
    await userEvent.click(saveButton());
    await waitFor(() => expect(h.saveSobaFormSubmission).toHaveBeenCalledTimes(1));
    expect(h.openSobaFormSubmission).toHaveBeenCalledTimes(1);
  });

  it('lets an upload made while a save is opening wait on that same open', async () => {
    let finishOpen: () => void = () => undefined;
    h.openSobaFormSubmission.mockImplementationOnce(
      (_token: unknown, _formId: unknown, id: string) =>
        new Promise((resolve) => {
          finishOpen = () => resolve(opened(id));
        }),
    );
    await renderLoaded();
    await userEvent.click(saveButton());
    let named: Promise<string> = Promise.resolve('');
    act(() => {
      named = openedActiveSubmissionId();
    });
    await act(async () => finishOpen());
    expect(await named).toBe(openedId());
    await waitFor(() => expect(h.saveSobaFormSubmission).toHaveBeenCalledTimes(1));
    expect(h.openSobaFormSubmission).toHaveBeenCalledTimes(1);
  });

  it('opens again under the same id after an open that got no response', async () => {
    h.openSobaFormSubmission.mockRejectedValueOnce(new NetworkError(new TypeError('Failed')));
    await renderLoaded();
    await userEvent.click(saveButton());
    await waitFor(() =>
      expect(saveStatus().textContent).toBe('Draft may not be saved. You are offline.'),
    );
    expect(h.saveSobaFormSubmission).not.toHaveBeenCalled();
    await userEvent.click(saveButton());
    await waitFor(() => expect(h.saveSobaFormSubmission).toHaveBeenCalledTimes(1));
    expect(openedId(1)).toBe(openedId(0));
  });

  // The address of an opened submission is its fill page while this page stays mounted, so a later
  // visit to the start address must not land on that submission.
  it('starts a new submission when the start address is visited again after an open', async () => {
    const tree = () => (
      <Provider store={store}>
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
          <FormioV5NewSubmissionClient formId="form-1" />
        </SWRConfig>
      </Provider>
    );
    let view: ReturnType<typeof render> | undefined;
    await act(async () => {
      view = render(tree());
    });
    await answerInit(store, { authenticated: false });
    await waitFor(() => expect(saveButton()).toBeEnabled());
    await userEvent.click(saveButton());
    await waitFor(() => expect(h.saveSobaFormSubmission).toHaveBeenCalledTimes(1));

    h.pathname = `/en/submit/${openedId()}`;
    await act(async () => view!.rerender(tree()));
    expect(h.mounts).toBe(1);

    h.pathname = '/en/form/form-1';
    await act(async () => view!.rerender(tree()));
    await waitFor(() => expect(h.mounts).toBe(2));
    // Read afresh: the remounted page never takes the copy the page it replaced read.
    expect(h.getSubmitForm).toHaveBeenCalledTimes(2);
    expect(h.getSubmitFormVersionSchema).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(saveButton()).toBeEnabled());
    await userEvent.click(saveButton());
    await waitFor(() => expect(h.saveSobaFormSubmission).toHaveBeenCalledTimes(2));
    expect(openedId(1)).not.toBe(openedId(0));
  });

  // Back to an opened submission's address restores the page that address was made from.
  it('hands an address that is not its own to the server route', async () => {
    const page = await renderTree();
    await waitFor(() => expect(saveButton()).toBeEnabled());
    h.pathname = '/en/submit/another-submission';
    await page.rerender();
    expect(h.replace).toHaveBeenCalledWith('/en/submit/another-submission');
    expect(screen.queryByTestId('fill-form')).not.toBeInTheDocument();
  });

  it('hands over when it is restored at an opened submission address', async () => {
    h.pathname = '/en/submit/opened-earlier';
    await renderTree();
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith('/en/submit/opened-earlier'));
    expect(screen.queryByTestId('fill-form')).not.toBeInTheDocument();
  });

  // The load held here predates the open, so a form mounted from it again would open and write
  // over the saved submission.
  it('keeps handing over when history returns to its own address before the hand-over lands', async () => {
    const page = await renderTree();
    await waitFor(() => expect(saveButton()).toBeEnabled());
    await userEvent.click(saveButton());
    await waitFor(() => expect(h.saveSobaFormSubmission).toHaveBeenCalledTimes(1));
    const own = `/en/submit/${openedId()}`;
    h.pathname = own;
    await page.rerender();
    h.pathname = '/en/submit/another-submission';
    await page.rerender();
    h.pathname = own;
    await page.rerender();
    expect(screen.queryByTestId('fill-form')).not.toBeInTheDocument();
    expect(h.replace).toHaveBeenLastCalledWith(own);
    expect(h.mounts).toBe(1);
  });

  it('reads a percent-encoded start address as the form it names', async () => {
    h.pathname = '/en/form/form%201';
    await renderInStore(store, <FormioV5NewSubmissionClient formId="form 1" />);
    await answerInit(store, { authenticated: false });
    await waitFor(() => expect(h.getSubmitForm).toHaveBeenCalledWith(undefined, 'form 1'));
    await waitFor(() => expect(screen.getByTestId('fill-form')).toBeInTheDocument());
    expect(h.replace).not.toHaveBeenCalled();
  });

  it('leaves the address alone when the open lands after the filler moved on', async () => {
    const land = holdOpen();
    await renderTree();
    await waitFor(() => expect(saveButton()).toBeEnabled());
    await userEvent.click(saveButton());
    globalThis.history.pushState(null, '', '/en/my-forms');
    await land();
    await waitFor(() => expect(h.saveSobaFormSubmission).toHaveBeenCalledTimes(1));
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('leaves the address alone when the open lands after the page is gone', async () => {
    const land = holdOpen();
    const page = await renderTree();
    await waitFor(() => expect(saveButton()).toBeEnabled());
    await userEvent.click(saveButton());
    await waitFor(() => expect(h.openSobaFormSubmission).toHaveBeenCalledTimes(1));
    await page.unmount();
    await land();
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('moves the address under the base path the app is served from', async () => {
    vi.stubEnv('NEXT_PUBLIC_BASE_PATH', '/designer');
    try {
      globalThis.history.pushState(null, '', '/designer/en/form/form-1');
      await renderLoaded();
      await userEvent.click(saveButton());
      await waitFor(() => expect(h.saveSobaFormSubmission).toHaveBeenCalledTimes(1));
      expect(replaceState).toHaveBeenCalledWith(null, '', `/designer/en/submit/${openedId()}`);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('names nothing for an upload once the page is gone, and opens nothing', async () => {
    const page = await renderTree();
    await waitFor(() => expect(saveButton()).toBeEnabled());
    await page.unmount();
    let named: string | null = null;
    await act(async () => {
      named = await openedActiveSubmissionId();
    });
    expect(named).toBe('');
    expect(h.openSobaFormSubmission).not.toHaveBeenCalled();
  });

  it('names the submission an upload was opened for, though another is filled by then', async () => {
    const land = holdOpen();
    await renderLoaded();
    let named: Promise<string> = Promise.resolve('');
    act(() => {
      named = openedActiveSubmissionId();
    });
    await waitFor(() => expect(h.openSobaFormSubmission).toHaveBeenCalledTimes(1));
    setActiveSubmission({ submissionId: 'another-submission', signedIn: false });
    await land();
    expect(await named).toBe(openedId());
  });

  it.each([
    ['the caller', () => (h.access = { caller: { idpCode: null }, pending: true })],
    ['the file limits', () => (h.files = { option: {}, ready: false })],
  ])('waits for %s before mounting the form', async (_label, arrange) => {
    arrange();
    await renderPage();
    await waitFor(() => expect(h.getSubmitFormVersionSchema).toHaveBeenCalled());
    await act(async () => undefined);
    expect(screen.queryByTestId('fill-form')).not.toBeInTheDocument();
  });

  it('shows the load text, not the fill page offline text, when the form cannot be reached', async () => {
    h.getSubmitForm.mockRejectedValue(new NetworkError(new TypeError('Failed')));
    await renderPage();
    await waitFor(() =>
      expect(screen.getByTestId('new-submission-loaderror')).toHaveTextContent(
        'Could not load the form.',
      ),
    );
  });

  it('says why when the schema read is refused', async () => {
    h.getSubmitFormVersionSchema.mockRejectedValue(
      new ApiError('Form version is not the published version', 409, 'version_not_published'),
    );
    await renderPage();
    await waitFor(() =>
      expect(screen.getByTestId('new-submission-loaderror')).toHaveTextContent(
        'This version of the form is no longer accepting submissions.',
      ),
    );
    expect(screen.queryByTestId('fill-form')).not.toBeInTheDocument();
  });

  it('stays busy after Reload latest until the fill page takes over', async () => {
    h.saveSobaFormSubmission.mockResolvedValue({
      headRevisionId: 'rev-head',
      workflowState: 'draft',
      revision: { id: 'rev-x', revisionNo: 1, status: 'pending', reason: 'conflict' },
    });
    await renderLoaded();
    await userEvent.click(saveButton());
    await waitFor(() => expect(screen.getByTestId('submission-fill-held')).toBeInTheDocument());
    await userEvent.click(screen.getByTestId('submission-fill-reload-latest'));
    expect(h.replace).toHaveBeenCalledWith(`/en/submit/${openedId()}`);
    expect(saveButton()).toBeDisabled();
    expect(screen.getByTestId('submission-fill-reload-latest')).toBeDisabled();
  });

  it('says how to start again when the id is taken', async () => {
    h.openSobaFormSubmission.mockRejectedValue(
      new ApiError('Submission id already in use', 409, 'submission_id_taken'),
    );
    await renderLoaded();
    await userEvent.click(saveButton());
    await waitFor(() =>
      expect(saveStatus().textContent).toBe('Draft not saved. Reload the page to start again.'),
    );
  });

  describe('when the form was published again', () => {
    const replaced = new ApiError(
      'Form version is not the published version',
      409,
      'version_not_published',
    );

    beforeEach(() => {
      h.openSobaFormSubmission.mockRejectedValueOnce(replaced);
      h.getSubmitForm
        .mockResolvedValueOnce(form)
        .mockResolvedValue({ ...form, publishedVersionId: 'ver-2' });
    });

    // A form without drafts has no Save draft, so its submit is the write that opens.
    it('asks on a submit, and moves with the facts read with the new version', async () => {
      const changed = { components: [{ key: 'email', type: 'email' }] };
      h.getSubmitForm.mockReset();
      h.getSubmitForm
        .mockResolvedValueOnce({ ...form, allowSubmitterDrafts: false })
        .mockResolvedValue({ ...form, publishedVersionId: 'ver-2', allowSubmitterDrafts: true });
      h.getSubmitFormVersionSchema.mockImplementation(async (_token: unknown, id: string) =>
        id === 'ver-2' ? version(id, 'hash-2', changed) : version(id, 'hash-1'),
      );
      await renderPage();
      await waitFor(() => expect(screen.getByTestId('fill-form')).toBeInTheDocument());
      expect(screen.queryByTestId('submission-fill-save-draft')).not.toBeInTheDocument();
      await submit({ name: 'Ada' });
      expect(screen.getByTestId('submission-fill-form-updated')).toBeInTheDocument();
      expect(h.instance.emit).toHaveBeenCalledWith('submitError', '');
      expect(screen.queryByTestId('submission-fill-render-error')).not.toBeInTheDocument();
      expect(h.submitSobaFormSubmission).not.toHaveBeenCalled();
      await userEvent.click(screen.getByTestId('submission-fill-continue-updated'));
      await waitFor(() => expect(h.mounts).toBe(2));
      expect(h.form).toEqual(changed);
      expect(screen.getByTestId('submission-fill-save-draft')).toBeInTheDocument();
    });

    it('tries the version it last sent first, where an open whose answer was lost landed', async () => {
      h.getSubmitFormVersionSchema.mockImplementation(async (_token: unknown, id: string) =>
        version(id, 'hash-1'),
      );
      h.openSobaFormSubmission.mockRejectedValueOnce(new NetworkError(new TypeError('Failed')));
      await renderLoaded();
      await userEvent.click(saveButton());
      await waitFor(() =>
        expect(saveStatus().textContent).toBe('Draft may not be saved. You are offline.'),
      );
      expect([openedOn(0), openedOn(1)]).toEqual(['ver-1', 'ver-2']);
      await userEvent.click(saveButton());
      await waitFor(() => expect(h.saveSobaFormSubmission).toHaveBeenCalledTimes(1));
      expect(openedOn(2)).toBe('ver-2');
      expect(openedId(2)).toBe(openedId(0));
    });

    it('opens on the new version without asking when it renders the same', async () => {
      h.getSubmitFormVersionSchema.mockImplementation(async (_token: unknown, id: string) =>
        version(id, 'hash-1'),
      );
      await renderLoaded();
      await userEvent.click(saveButton());
      await waitFor(() => expect(h.saveSobaFormSubmission).toHaveBeenCalledTimes(1));
      expect(openedOn(0)).toBe('ver-1');
      expect(openedOn(1)).toBe('ver-2');
      expect(openedId(1)).toBe(openedId(0));
      expect(screen.queryByTestId('submission-fill-form-updated')).not.toBeInTheDocument();
      expect(h.mounts).toBe(1);
    });

    it('moves over with the answers when Continue comes after the session ended', async () => {
      const changed = { components: [{ key: 'email', type: 'email' }] };
      h.getSubmitFormVersionSchema.mockImplementation(async (_token: unknown, id: string) =>
        id === 'ver-2' ? version(id, 'hash-2', changed) : version(id, 'hash-1'),
      );
      await renderTree({ authenticated: true, token: 'token' });
      await waitFor(() => expect(saveButton()).toBeEnabled());
      await userEvent.click(saveButton());
      await waitFor(() =>
        expect(screen.getByTestId('submission-fill-form-updated')).toBeInTheDocument(),
      );
      // A rejected refresh: no token, and the Header's sweep empties and re-reads every read.
      h.access = { caller: { idpCode: 'public' }, pending: false };
      await act(async () => {
        store.dispatch(clear());
      });
      await act(async () => {
        await h.swrMutate!(() => true, undefined, { revalidate: true });
      });
      h.formData = { name: 'Ada', extra: 'typed' };
      await userEvent.click(screen.getByTestId('submission-fill-continue-updated'));
      await waitFor(() => expect(h.mounts).toBe(2));
      expect(h.form).toEqual(changed);
      expect(h.submission).toEqual({ data: { name: 'Ada', extra: 'typed' } });
      expect(screen.queryByTestId('new-submission-session-expired')).not.toBeInTheDocument();
      // Still writable: the next write reports the ended session rather than a read-only form.
      expect(h.options?.readOnly).toBe(false);
    });

    it('asks before moving to a version that renders differently, and sends nothing', async () => {
      const changed = { components: [{ key: 'email', type: 'email' }] };
      h.getSubmitFormVersionSchema.mockImplementation(async (_token: unknown, id: string) =>
        id === 'ver-2' ? version(id, 'hash-2', changed) : version(id, 'hash-1'),
      );
      await renderLoaded();
      await userEvent.click(saveButton());
      await waitFor(() =>
        expect(screen.getByTestId('submission-fill-form-updated')).toHaveTextContent(
          'This form was updated. Your answers are kept.',
        ),
      );
      expect(saveStatus().textContent).toBe('Draft not saved.');
      expect(h.saveSobaFormSubmission).not.toHaveBeenCalled();
      expect(h.openSobaFormSubmission).toHaveBeenCalledTimes(1);
      expect(saveButton()).toBeDisabled();

      h.formData = { name: 'Ada', extra: 'typed' };
      await userEvent.click(screen.getByTestId('submission-fill-continue-updated'));
      await waitFor(() => expect(h.mounts).toBe(2));
      expect(h.form).toEqual(changed);
      expect(h.submission).toEqual({ data: { name: 'Ada', extra: 'typed' } });
      expect(h.saveSobaFormSubmission).not.toHaveBeenCalled();

      await waitFor(() => expect(saveButton()).toBeEnabled());
      await userEvent.click(saveButton());
      await waitFor(() => expect(h.saveSobaFormSubmission).toHaveBeenCalledTimes(1));
      expect(openedOn(1)).toBe('ver-2');
      expect(openedId(1)).toBe(openedId(0));
    });
  });

  it('sends nothing anonymously when the session ended before the open', async () => {
    await renderLoaded({ authenticated: true, token: 'token' });
    expect(h.getSubmitForm).toHaveBeenCalledWith('token', 'form-1');
    await act(async () => {
      store.dispatch(clear());
    });
    await userEvent.click(saveButton());
    await waitFor(() =>
      expect(saveStatus().textContent).toBe('Draft not saved. Your session has ended.'),
    );
    expect(h.openSobaFormSubmission).not.toHaveBeenCalled();
  });

  it.each([
    [
      'refused to an anonymous caller',
      new ApiError('Not authorized to submit this form', 401, 'open_denied'),
      'new-submission-loaderror',
      'You are not able to submit this form.',
    ],
    [
      'refused to a signed-in caller',
      new ApiError('Not authorized to submit this form', 403, 'open_denied'),
      'new-submission-refused',
      'You are not able to submit this form.',
    ],
    [
      'without a published version',
      new ApiError('Form has no published version', 404, 'not_published'),
      'new-submission-notfound',
      'This form is not accepting submissions.',
    ],
    [
      'missing',
      new ApiError('Form not found', 404, 'form_not_found'),
      'new-submission-notfound',
      'This form could not be found.',
    ],
  ])('says why when the form read is %s', async (_label, failure, testId, text) => {
    h.getSubmitForm.mockRejectedValue(failure);
    await renderPage();
    await waitFor(() => expect(screen.getByTestId(testId)).toHaveTextContent(text));
    expect(screen.queryByTestId('fill-form')).not.toBeInTheDocument();
  });
});
