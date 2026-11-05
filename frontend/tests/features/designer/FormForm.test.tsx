import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import en from '@/dictionaries/en.json';

// Set per test: whether the user is signed in, and the query string the page was opened with.
const session = vi.hoisted(() => ({ authenticated: true, search: '', path: '' }));

vi.mock('@/lib/hooks/useKeycloak', () => ({
  useKeycloak: () => ({
    authenticated: session.authenticated,
    token: session.authenticated ? 'token' : null,
    initializing: false,
  }),
}));

vi.mock('@/app/[lang]/Providers', () => ({
  useDictionary: () => ({
    ...en,
    form: {
      loading: 'Loading',
      previewSubmissionDisabled: 'Submission during a preview is disabled.',
      apiKey: 'API Key',
      nameLabel: 'Form Name',
      descriptionLabel: 'Description',
      noActiveWorkspace: 'Select a workspace before creating a form.',
      noActiveWorkspaceError: 'Select a workspace before saving this form.',
      disclaimerRequired: 'Accept the workspace disclaimer before creating a form.',
      schemaNotAvailable: 'Form schema not available.',
      loadFormError: 'Failed to load form.',
      staleEdits: 'Your unsaved edits were made on an older version of this form.',
      discardEdits: 'Discard edits',
      settings: {
        formSettingsDrawerLabel: 'Form Settings',
        formKindList: { team: 'Team', public: 'Public' },
      },
    },
    general: { notAuthenticated: 'Not authed', lookupTruncated: 'Showing the first {limit}.' },
    workspaces: { workspace: 'Workspace' },
    ministries: { min1: 'Ministry 1' },
    locale: 'en',
    modal: {
      dialogActions: 'Dialog actions',
    },
    useCases: {
      application: 'Applications that will be evaluated followed by a decision',
      collection: 'Collection of Datasets, data submission',
      feedback:
        'Feedback Form to determine satisfaction, agreement, likelihood, or other qualitative questions',
      report: 'Reporting usually on a repeating schedule or event driven like follow-ups',
      registration: 'Registrations or Sign up - no evaluation',
    },
    submission: {
      error: 'Error',
      review: { listAllStatuses: 'All', statuses: {} },
      export: { button: 'Export submissions' },
    },
    team: {
      loadError: 'Error',
    },
    dataTable: {
      emptyMessage: 'Empty',
      pageOf: 'of {totalPages} page(s)',
    },
    postSubmission: { tab: 'After Submission' },
    jobs: { heading: 'Jobs' },
  }),
}));

// Whether post-submission is available, as the server would answer for the scope asked about.
const availability = vi.hoisted(() => ({ check: vi.fn() }));

vi.mock('@/src/shared/featureFlags/featureAvailability', () => ({
  fetchFeatureAvailability: availability.check,
}));

vi.mock('@/src/features/post-submission/ui/FormPostSubmissionTab', () => ({
  default: () => <div data-testid="post-submission-content" />,
}));

vi.mock('@/src/features/jobs/ui/ScopedJobsTabs', () => ({
  FormJobsTab: () => <div data-testid="jobs-content" />,
}));

type Workspace = {
  id: string;
  name?: string;
  kind?: string;
  role?: string;
  disclaimerAccepted: boolean;
};
type Version = { id: string; versionNo: number; state: string };

const { mockWorkspaceState, api, builder } = vi.hoisted(() => ({
  mockWorkspaceState: {
    creatable: [{ id: 'ws1', disclaimerAccepted: true }] as Workspace[],
    formCreate: 'allowed' as string,
    versions: [] as Version[],
    // When set, the version options the lookup returns instead of every version.
    versionOptions: null as { items: Version[]; truncated: boolean } | null,
    schemas: {} as Record<string, unknown>,
  },
  // Captured so a test can simulate the user editing in the builder.
  builder: { onUpdateModel: null as ((model: unknown) => void) | null },
  api: {
    saveFormVersionSchema: vi.fn(),
    publishSobaFormVersion: vi.fn(),
    createFormVersion: vi.fn(),
    createSobaFormioForm: vi.fn(),
    updateSobaForm: vi.fn().mockResolvedValue({}),
    getFormVersionSchema: vi.fn(),
    getSobaForm: vi.fn(),
    lookupFormVersions: vi.fn(),
    lookupWorkspaces: vi.fn(),
    selectWorkspace: vi.fn((_token: string, id: string) =>
      Promise.resolve({ id, name: 'Alpha', kind: 'team', role: 'owner', disclaimerAccepted: true }),
    ),
  },
}));

vi.mock('@/src/shared/api/sobaApi', () => ({
  getSobaForm: api.getSobaForm,
  lookupFormVersions: api.lookupFormVersions,
  getSobaFormVersion: vi.fn((_token: string, id: string) =>
    Promise.resolve(mockWorkspaceState.versions.find((v) => v.id === id)),
  ),
  getFormVersionSchema: api.getFormVersionSchema,
  saveFormVersionSchema: api.saveFormVersionSchema,
  publishSobaFormVersion: api.publishSobaFormVersion,
  createFormVersion: api.createFormVersion,
  createSobaFormioForm: api.createSobaFormioForm,
  updateSobaForm: api.updateSobaForm,
  lookupWorkspaces: api.lookupWorkspaces,
  selectWorkspace: api.selectWorkspace,
  fetchCurrentUser: vi.fn(() =>
    Promise.resolve({
      capabilities: {
        canCreateWorkspace: false,
        hasWorkspaces: true,
        formCreate: mockWorkspaceState.formCreate,
        isSobaAdmin: false,
      },
    }),
  ),
}));

// Mock DynamicForm and FormDesigner components used in FormForm
const preview = vi.hoisted(() => ({
  cancel: vi.fn(),
  beforeSubmit: null as
    | ((submission: unknown, next: (error: { silent: boolean }) => void) => void)
    | null,
}));
vi.mock('@/src/features/formio-v5/ui/DynamicForm', () => ({
  DynamicForm: ({
    options,
  }: {
    options: {
      hooks: {
        beforeSubmit: NonNullable<typeof preview.beforeSubmit>;
      };
    };
  }) => {
    preview.beforeSubmit = options.hooks.beforeSubmit;
    return (
      <div data-testid="dynamic-form">
        <button onClick={() => options.hooks.beforeSubmit({ data: {} }, preview.cancel)}>
          Submit preview
        </button>
      </div>
    );
  },
}));

vi.mock('@bcgov/design-system-react-components', async (importOriginal) => {
  type DesignSystem = typeof import('@bcgov/design-system-react-components') & {
    Tab: React.ElementType;
    Tabs: React.ElementType;
  };
  const mod = await importOriginal<DesignSystem & { default?: DesignSystem }>();
  const actual = mod.default || mod;
  return {
    __esModule: true,
    ...actual,
    TextField: actual.TextField,
    Button: actual.Button,
    InlineAlert: actual.InlineAlert,
    Tab: actual.Tab,
    Tabs: actual.Tabs,
    Select: ({
      selectedKey,
      onSelectionChange,
      items,
      'aria-label': ariaLabel,
      description,
      'data-testid': testId,
    }: {
      selectedKey: string;
      onSelectionChange: (newVal: unknown) => void;
      items: { id: string; label: string }[];
      'aria-label': string;
      'data-testid': string;
      description: string;
    }) => {
      return (
        <div data-testid={testId}>
          {/* As react-aria's hidden select does, input and change both report a selection that
              differs from the selected key. */}
          <select
            value={selectedKey || ''}
            onChange={(e) => {
              if (e.target.value !== (selectedKey || '')) onSelectionChange?.(e.target.value);
            }}
            onInput={(e) => {
              const value = e.currentTarget.value;
              if (value !== (selectedKey || '')) onSelectionChange?.(value);
            }}
            aria-label={ariaLabel}
          >
            <option value="">Select...</option>
            {items?.map((item: { id: string; label: string }) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
          {description && <div>{description}</div>}
        </div>
      );
    },
  };
});

// The real FormDesigner takes its model once at mount and ignores later changes. The stub does the
// same, so a version switch that fails to remount it is visible here.
vi.mock('@/src/features/designer/ui/FormDesigner', () => {
  function FormDesignerStub({
    initialModel,
    onUpdateModel,
  }: {
    initialModel: unknown;
    onUpdateModel: (model: unknown) => void;
  }) {
    const [snapshot] = React.useState(() => JSON.stringify(initialModel));
    builder.onUpdateModel = onUpdateModel;
    return <div data-testid="form-designer">{snapshot}</div>;
  }
  return { __esModule: true, default: FormDesignerStub };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {} }),
  useParams: () => ({ lang: 'en' }),
  useSearchParams: () => new URLSearchParams(session.search),
  usePathname: () => session.path,
}));

import { Provider } from 'react-redux';
import { SWRConfig } from 'swr';
import makeStore from '@/lib/store';
import { setAuthenticated, setToken } from '@/lib/slices/keycloakSlice';
import FormForm from '@/src/features/designer/ui/FormForm';
import { PageLayout } from '@/src/components/PageLayout';
import { ApiError } from '@/src/shared/api/sobaHelpers';

let store: ReturnType<typeof makeStore>;

const newestFirst = (versions: Version[]) =>
  [...versions].sort((a, b) => b.versionNo - a.versionNo);

async function renderForm(props: { formId: string }) {
  const view: ReturnType<typeof render> | undefined = render(
    <Provider store={store}>
      <SWRConfig
        value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}
      >
        <PageLayout headingId="designer-heading" heading="Form Designer">
          <FormForm {...props} />
        </PageLayout>
      </SWRConfig>
    </Provider>,
  );
  return view!;
}

describe('FormForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store = makeStore();
    store.dispatch(setToken('token'));
    store.dispatch(setAuthenticated(true));
    session.authenticated = true;
    session.search = '';
    session.path = '';
    availability.check.mockResolvedValue(false);
    mockWorkspaceState.creatable = [{ id: 'ws1', disclaimerAccepted: true }];
    mockWorkspaceState.formCreate = 'allowed';
    mockWorkspaceState.versions = [];
    mockWorkspaceState.versionOptions = null;
    mockWorkspaceState.schemas = {};
    api.getFormVersionSchema.mockImplementation((_token: string, versionId: string) =>
      Promise.resolve(mockWorkspaceState.schemas[versionId] ?? { components: [] }),
    );
    // The server's current version is the highest-numbered one.
    api.getSobaForm.mockImplementation(() =>
      Promise.resolve({
        id: 'f1',
        name: 'Test',
        description: '',
        permissions: ['*'],
        currentVersion: newestFirst(mockWorkspaceState.versions)[0] ?? null,
      }),
    );
    api.lookupFormVersions.mockImplementation(() =>
      Promise.resolve({
        limit: 500,
        ...(mockWorkspaceState.versionOptions ?? {
          items: newestFirst(mockWorkspaceState.versions),
          truncated: false,
        }),
      }),
    );
    api.lookupWorkspaces.mockImplementation(() =>
      Promise.resolve({ items: mockWorkspaceState.creatable, limit: 500, truncated: false }),
    );
    api.createFormVersion.mockResolvedValue({
      value: { id: 'v-new', versionNo: 3, state: 'draft' },
      created: true,
    });
    api.saveFormVersionSchema.mockResolvedValue({});
    api.publishSobaFormVersion.mockResolvedValue({});
    builder.onUpdateModel = null;
  });

  it('renders designer tab content when authenticated and not initializing', async () => {
    await act(async () => {
      await renderForm({ formId: 'f1' });
    });
    // The designer area includes a form name heading; assert it renders with loaded value
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Test' })).toBeInTheDocument());
  });

  it('warns and cancels every preview submission before it completes', async () => {
    mockWorkspaceState.versions = [{ id: 'v1', versionNo: 1, state: 'draft' }];
    await act(async () => {
      await renderForm({ formId: 'f1' });
    });
    await userEvent.click(screen.getByTestId('preview-form-button'));
    const submit = await screen.findByRole('button', { name: 'Submit preview' });

    await userEvent.click(submit);
    await userEvent.click(submit);

    expect(store.getState().notification.notifications).toEqual([
      expect.objectContaining({ text: en.form.previewSubmissionDisabled, type: 'warning' }),
      expect.objectContaining({ text: en.form.previewSubmissionDisabled, type: 'warning' }),
    ]);
    expect(preview.cancel).toHaveBeenCalledTimes(2);
    expect(preview.cancel).toHaveBeenNthCalledWith(1, { silent: true });
    expect(preview.cancel).toHaveBeenNthCalledWith(2, { silent: true });
    expect(screen.getByTestId('dynamic-form')).toBeInTheDocument();
  });

  it('prevents real Form.io completion and clears loading without losing preview data', async () => {
    mockWorkspaceState.versions = [{ id: 'v1', versionNo: 1, state: 'draft' }];
    await act(async () => {
      await renderForm({ formId: 'f1' });
    });
    await userEvent.click(screen.getByTestId('preview-form-button'));
    await screen.findByRole('button', { name: 'Submit preview' });

    const { Formio } = await import('@formio/js');
    const host = document.createElement('div');
    const instance = await Formio.createForm(
      host,
      {
        components: [
          { type: 'textfield', key: 'name', input: true },
          { type: 'button', key: 'submit', action: 'submit', label: 'Submit' },
        ],
      },
      { hooks: { beforeSubmit: preview.beforeSubmit! } },
    );
    try {
      await instance.setSubmission({ data: { name: 'Preview answer' } });
      const onSubmit = vi.fn();
      const onSubmitDone = vi.fn();
      instance.on('submit', onSubmit);
      instance.on('submitDone', onSubmitDone);

      await act(async () => {
        await expect(instance.submit()).rejects.toBe(false);
        await expect(instance.submit()).rejects.toBe(false);
      });

      expect(onSubmit).not.toHaveBeenCalled();
      expect(onSubmitDone).not.toHaveBeenCalled();
      expect(instance.submitting).toBe(false);
      expect(instance.submissionInProcess).toBe(false);
      expect(instance.data).toMatchObject({ name: 'Preview answer' });
      expect(host).not.toHaveTextContent('Submission Complete');
    } finally {
      instance.destroy();
    }
  }, 15000);

  // The form's current version is what the builder is fed.
  it('reads the schema of the current version', async () => {
    mockWorkspaceState.versions = [
      { id: 'v1', versionNo: 1, state: 'published' },
      { id: 'v2', versionNo: 2, state: 'draft' },
    ];
    await act(async () => {
      await renderForm({ formId: 'f1' });
    });

    const { getFormVersionSchema } = await import('@/src/shared/api/sobaApi');
    await waitFor(() => expect(getFormVersionSchema).toHaveBeenCalledWith('token', 'v2'));
    expect(getFormVersionSchema).not.toHaveBeenCalledWith('token', 'v1');
  });

  // The options stop at the lookup limit and their order is the endpoint's. Neither may decide
  // which version a save writes to.
  it('saves to the form current version when the options do not include it', async () => {
    mockWorkspaceState.versions = [
      { id: 'v1', versionNo: 1, state: 'published' },
      { id: 'v2', versionNo: 2, state: 'draft' },
    ];
    mockWorkspaceState.versionOptions = {
      items: [{ id: 'v1', versionNo: 1, state: 'published' }],
      truncated: true,
    };
    await act(async () => {
      await renderForm({ formId: 'f1' });
    });
    await waitFor(() => expect(screen.getByTestId('form-designer')).toBeInTheDocument());
    expect(screen.getAllByText('Showing the first 500.').length).toBeGreaterThan(0);

    await userEvent.click(screen.getByTestId('save-form-button'));
    await waitFor(() => expect(api.saveFormVersionSchema).toHaveBeenCalled());
    expect(api.saveFormVersionSchema.mock.calls[0][1]).toBe('v2');
  });

  // Someone else created v2 while v1 was open. The refused edits are kept, but they were made on v1
  // and must not be saved onto v2: they can go to a new version or be discarded.
  it('blocks saving stale edits onto the newer version after a save is refused', async () => {
    mockWorkspaceState.versions = [{ id: 'v1', versionNo: 1, state: 'draft' }];
    mockWorkspaceState.schemas = { v1: { components: [{ key: 'original' }] } };
    await act(async () => {
      await renderForm({ formId: 'f1' });
    });
    await waitFor(() => expect(screen.getByTestId('form-designer')).toHaveTextContent('original'));

    await act(async () => {
      builder.onUpdateModel?.({ components: [{ key: 'edited' }] } as never);
    });
    api.saveFormVersionSchema.mockImplementationOnce(() => {
      mockWorkspaceState.versions = [
        ...mockWorkspaceState.versions,
        { id: 'v2', versionNo: 2, state: 'draft' },
      ];
      return Promise.reject(new ApiError('Conflict', 409));
    });

    await userEvent.click(screen.getByTestId('save-form-button'));

    expect(await screen.findByTestId('page-notice-stale-edits')).toBeInTheDocument();
    expect(screen.getAllByText('Current Draft (v2)').length).toBeGreaterThan(0);
    expect(screen.getByTestId('save-form-button')).toBeDisabled();
    expect(screen.getByTestId('publish-form-button')).toBeDisabled();
    const picker = screen
      .getByTestId('form-version-select')
      .querySelector('select') as HTMLSelectElement;
    expect(picker).not.toBeDisabled();

    await userEvent.click(screen.getByTestId('page-notice-stale-edits-action'));
    await waitFor(() =>
      expect(screen.queryByTestId('page-notice-stale-edits')).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId('save-form-button')).toBeEnabled();
    expect(api.saveFormVersionSchema).toHaveBeenCalledTimes(1);
  });

  // Publishing changes the state that gates Save, and that state comes from the form.
  it('publishes the current version and reads the form again', async () => {
    mockWorkspaceState.versions = [{ id: 'v1', versionNo: 1, state: 'draft' }];
    await act(async () => {
      await renderForm({ formId: 'f1' });
    });
    await waitFor(() => expect(screen.getByTestId('publish-form-button')).toBeEnabled());
    const formReads = api.getSobaForm.mock.calls.length;

    await userEvent.click(screen.getByTestId('publish-form-button'));
    await waitFor(() => expect(api.publishSobaFormVersion).toHaveBeenCalledWith('token', 'v1'));
    await waitFor(() => expect(api.getSobaForm.mock.calls.length).toBeGreaterThan(formReads));
  });

  // Switching versions changes which schema is read, and the read-only notice explains why save is
  // off. Selecting the current draft again returns to it.
  it('reads the selected version schema when switching to history', async () => {
    mockWorkspaceState.versions = [
      { id: 'v1', versionNo: 1, state: 'published' },
      { id: 'v2', versionNo: 2, state: 'draft' },
    ];
    await act(async () => {
      await renderForm({ formId: 'f1' });
    });

    const { getFormVersionSchema } = await import('@/src/shared/api/sobaApi');
    await waitFor(() => expect(getFormVersionSchema).toHaveBeenCalledWith('token', 'v2'));

    const picker = (await screen.findByTestId('form-version-select')).querySelector(
      'select',
    ) as HTMLSelectElement;
    await userEvent.selectOptions(picker, 'v1');

    await waitFor(() => expect(getFormVersionSchema).toHaveBeenCalledWith('token', 'v1'));
    expect(await screen.findByTestId('page-notice-history-view')).toBeInTheDocument();
  });

  // The builder is fed its model once at mount. Returning to a version already in the cache
  // produces no loading frame, so the previous version stays on screen unless it is remounted.
  it('shows the right schema when switching back to a cached version', async () => {
    mockWorkspaceState.versions = [
      { id: 'v1', versionNo: 1, state: 'published' },
      { id: 'v2', versionNo: 2, state: 'draft' },
    ];
    mockWorkspaceState.schemas = {
      v1: { components: [{ key: 'from-v1' }] },
      v2: { components: [{ key: 'from-v2' }] },
    };
    await act(async () => {
      await renderForm({ formId: 'f1' });
    });

    const picker = (await screen.findByTestId('form-version-select')).querySelector(
      'select',
    ) as HTMLSelectElement;
    await waitFor(() => expect(screen.getByTestId('form-designer')).toHaveTextContent('from-v2'));

    await userEvent.selectOptions(picker, 'v1');
    await waitFor(() => expect(screen.getByTestId('form-designer')).toHaveTextContent('from-v1'));

    const picker2 = screen
      .getByTestId('form-version-select')
      .querySelector('select') as HTMLSelectElement;
    fireEvent.change(picker2, { target: { value: 'current' } });
    await waitFor(() => expect(screen.getByTestId('form-designer')).toHaveTextContent('from-v2'));
  });

  // Saving drops the edit overlay. Without writing the saved body into the cache, the next write
  // posts the schema as it was before the edits.
  it('posts the saved schema, not the pre-save one, on a second save', async () => {
    mockWorkspaceState.versions = [{ id: 'v1', versionNo: 1, state: 'draft' }];
    mockWorkspaceState.schemas = { v1: { components: [{ key: 'original' }] } };
    await act(async () => {
      await renderForm({ formId: 'f1' });
    });
    await waitFor(() => expect(screen.getByTestId('form-designer')).toHaveTextContent('original'));

    await act(async () => {
      builder.onUpdateModel?.({ components: [{ key: 'edited' }] } as never);
    });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.saveFormVersionSchema).toHaveBeenCalledTimes(1));

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.saveFormVersionSchema).toHaveBeenCalledTimes(2));
    expect(api.saveFormVersionSchema.mock.calls[1][2]).toEqual({
      components: [{ key: 'edited' }],
    });
  });

  it('creates a new version from the saved schema', async () => {
    mockWorkspaceState.versions = [{ id: 'v1', versionNo: 1, state: 'draft' }];
    mockWorkspaceState.schemas = { v1: { components: [{ key: 'original' }] } };
    await act(async () => {
      await renderForm({ formId: 'f1' });
    });
    await waitFor(() => expect(screen.getByTestId('form-designer')).toHaveTextContent('original'));

    await act(async () => {
      builder.onUpdateModel?.({ components: [{ key: 'edited' }] } as never);
    });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.saveFormVersionSchema).toHaveBeenCalledTimes(1));

    const picker = screen
      .getByTestId('form-version-select')
      .querySelector('select') as HTMLSelectElement;
    await userEvent.selectOptions(picker, 'create');
    await waitFor(() => expect(api.createFormVersion).toHaveBeenCalled());
    // One request carries the schema; nothing is saved to the new version afterwards.
    expect(api.createFormVersion).toHaveBeenCalledWith(expect.any(String), {
      id: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ),
      formId: 'f1',
      fromFormVersionId: 'v1',
      schema: { components: [{ key: 'edited' }] },
    });
    expect(api.saveFormVersionSchema).toHaveBeenCalledTimes(1);
  });

  // Once the form is read again the new version is current, so the next save goes to it and not to
  // the version it was created from.
  it('saves to the new version after creating it', async () => {
    mockWorkspaceState.versions = [{ id: 'v1', versionNo: 1, state: 'draft' }];
    mockWorkspaceState.schemas = { v1: { components: [{ key: 'original' }] } };
    api.createFormVersion.mockImplementation(() => {
      const created = { id: 'v-new', versionNo: 2, state: 'draft' };
      mockWorkspaceState.versions = [...mockWorkspaceState.versions, created];
      return Promise.resolve({ value: created, created: true });
    });
    await act(async () => {
      await renderForm({ formId: 'f1' });
    });
    await waitFor(() => expect(screen.getByTestId('form-designer')).toHaveTextContent('original'));

    const picker = screen
      .getByTestId('form-version-select')
      .querySelector('select') as HTMLSelectElement;
    await userEvent.selectOptions(picker, 'create');
    await waitFor(() =>
      expect(screen.getAllByText('Current Draft (v2)').length).toBeGreaterThan(0),
    );
    // The create carries the schema itself, so the save is the first schema write.
    expect(api.saveFormVersionSchema).not.toHaveBeenCalled();

    await userEvent.click(screen.getByTestId('save-form-button'));
    await waitFor(() => expect(api.saveFormVersionSchema).toHaveBeenCalledTimes(1));
    expect(api.saveFormVersionSchema.mock.calls[0][1]).toBe('v-new');
  });

  // A change to the native select fires input and then change in one task, before React re-renders.
  it('creates one version when one pick reports the selection twice', async () => {
    mockWorkspaceState.versions = [{ id: 'v1', versionNo: 1, state: 'draft' }];
    await act(async () => {
      await renderForm({ formId: 'f1' });
    });
    await waitFor(() => expect(screen.getByTestId('form-designer')).toBeInTheDocument());

    const picker = screen
      .getByTestId('form-version-select')
      .querySelector('select') as HTMLSelectElement;
    act(() => {
      picker.value = 'create';
      picker.dispatchEvent(new Event('input', { bubbles: true }));
      picker.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await waitFor(() => expect(api.createFormVersion).toHaveBeenCalled());
    expect(api.createFormVersion).toHaveBeenCalledTimes(1);
  });

  // A new version's 409 is the backend's reason, not a form that changed since it was opened.
  it("reports a refused new version's own reason", async () => {
    mockWorkspaceState.versions = [{ id: 'v1', versionNo: 1, state: 'draft' }];
    api.createFormVersion.mockRejectedValue(new ApiError('The version to copy has no schema', 409));
    await act(async () => {
      await renderForm({ formId: 'f1' });
    });
    await waitFor(() => expect(screen.getByTestId('form-designer')).toBeInTheDocument());

    const picker = screen
      .getByTestId('form-version-select')
      .querySelector('select') as HTMLSelectElement;
    await userEvent.selectOptions(picker, 'create');

    const notices = () => store.getState().notification.notifications.map((n) => n.text);
    await waitFor(() => expect(notices()).toContain('The version to copy has no schema'));
    expect(screen.queryByTestId('page-notice-stale-edits')).not.toBeInTheDocument();
  });

  // The builder draws no Submit of its own, so Save writes the button the designer shows.
  it('starts a version with no saved schema from a Submit button, and saves it', async () => {
    mockWorkspaceState.versions = [{ id: 'v1', versionNo: 1, state: 'draft' }];
    api.getFormVersionSchema.mockResolvedValue(null);
    await act(async () => {
      await renderForm({ formId: 'f1' });
    });
    await waitFor(() => expect(screen.getByTestId('form-designer')).toBeInTheDocument());

    await userEvent.click(screen.getByTestId('save-form-button'));

    await waitFor(() => expect(api.saveFormVersionSchema).toHaveBeenCalledTimes(1));
    expect(api.saveFormVersionSchema.mock.calls[0][1]).toBe('v1');
    expect(api.saveFormVersionSchema.mock.calls[0][2]).toEqual({
      components: [expect.objectContaining({ type: 'button', key: 'submit', action: 'submit' })],
    });
  });

  // A form with no current version has nothing to save to. Writing anyway would file the schema
  // against a version the form does not carry.
  it('writes nothing for a form with no current version', async () => {
    mockWorkspaceState.versions = [];
    await act(async () => {
      await renderForm({ formId: 'f1' });
    });
    await waitFor(() => expect(screen.getByTestId('save-form-button')).toBeEnabled());

    await userEvent.click(screen.getByTestId('save-form-button'));
    expect(api.saveFormVersionSchema).not.toHaveBeenCalled();
  });

  // The schema key is null until the form arrives, so a loading flag covering only the schema read
  // reports ready before there is anything to draw.
  it('waits for the draft to assemble before drawing the designer', async () => {
    mockWorkspaceState.versions = [{ id: 'v1', versionNo: 1, state: 'draft' }];
    await act(async () => {
      await renderForm({ formId: 'f1' });
    });

    await waitFor(() => expect(screen.getByTestId('form-designer')).toBeInTheDocument());
  });

  // These reads do not revalidate on their own, so a failed load that still reports loading leaves
  // the designer on a spinner with every tab and action disabled, for the life of the page.
  it('reports a failed load instead of spinning', async () => {
    api.getSobaForm.mockRejectedValue(new Error('boom'));
    await act(async () => {
      await renderForm({ formId: 'f1' });
    });

    expect(await screen.findByTestId('page-notice-load-error')).toHaveTextContent(
      'Failed to load form.',
    );
    expect(screen.queryByTestId('loading-indicator')).not.toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  // The form loaded but its draft did not. An empty builder there reads as an empty form.
  it('shows the load error in place of the builder when the schema read fails', async () => {
    mockWorkspaceState.versions = [{ id: 'v1', versionNo: 1, state: 'draft' }];
    api.getFormVersionSchema.mockRejectedValue(new Error('boom'));
    await act(async () => {
      await renderForm({ formId: 'f1' });
    });

    expect(await screen.findByTestId('designer-load-error')).toHaveTextContent(
      'Failed to load form.',
    );
    expect(screen.queryByTestId('form-designer')).not.toBeInTheDocument();
  });

  // Nothing is read without a token, so no tab can be picked from the form's permissions.
  it('tells a signed-out user so instead of spinning', async () => {
    session.authenticated = false;
    await act(async () => {
      await renderForm({ formId: 'f1' });
    });

    expect(await screen.findByText('Not authed')).toBeInTheDocument();
    expect(screen.queryByTestId('loading-indicator')).not.toBeInTheDocument();
    expect(api.getSobaForm).not.toHaveBeenCalled();
  });

  describe('Tab Permissions', () => {
    const allTabs = [
      'designer-tab',
      'version-tab',
      'settings-tab',
      'jobs-tab',
      'team-tab',
      'submission-tab',
      'share-tab',
    ];

    const withPermissions = (permissions: string[]) =>
      api.getSobaForm.mockImplementation(() =>
        Promise.resolve({
          id: 'f1',
          name: 'Test',
          description: '',
          permissions,
          currentVersion: newestFirst(mockWorkspaceState.versions)[0] ?? null,
        }),
      );

    // The forms list and the submission view link to a tab by name.
    it('opens the tab named in the URL', async () => {
      session.search = 'tab=submissions';
      await act(async () => {
        await renderForm({ formId: 'f1' });
      });

      expect(await screen.findByTestId('submission-tab')).toHaveAttribute('aria-selected', 'true');
    });

    it('opens the first visible tab when the URL names one the user cannot see', async () => {
      session.search = 'tab=submissions';
      withPermissions(['design_update']);
      await act(async () => {
        await renderForm({ formId: 'f1' });
      });

      expect(await screen.findByTestId('designer-tab')).toHaveAttribute('aria-selected', 'true');
      expect(screen.queryByTestId('submission-tab')).not.toBeInTheDocument();
    });

    it.each([
      ['design_update', ['designer-tab', 'version-tab', 'share-tab']],
      ['form_update', ['settings-tab', 'jobs-tab', 'share-tab']],
      ['team_update', ['team-tab', 'share-tab']],
      ['submission_read', ['submission-tab', 'share-tab']],
      ['*', allTabs],
    ])('shows expected tabs when user has %s permission', async (permission, expectedTabs) => {
      withPermissions([permission]);
      await act(async () => {
        await renderForm({ formId: 'f1' });
      });

      for (const tab of allTabs) {
        if (expectedTabs.includes(tab)) {
          expect(screen.getByTestId(tab)).toBeInTheDocument();
        } else {
          expect(screen.queryByTestId(tab)).not.toBeInTheDocument();
        }
      }
    });

    describe('After Submission', () => {
      const inWorkspace = (permissions: string[], available: boolean) => {
        availability.check.mockResolvedValue(available);
        api.getSobaForm.mockImplementation(() =>
          Promise.resolve({
            id: 'f1',
            name: 'Test',
            description: '',
            workspaceId: 'ws1',
            permissions,
            currentVersion: newestFirst(mockWorkspaceState.versions)[0] ?? null,
          }),
        );
      };
      const tabOrder = () =>
        screen.getAllByRole('tab').map((tab) => tab.getAttribute('data-testid'));

      it('shows the tab right after Settings where post-submission is available for the form', async () => {
        inWorkspace(['*'], true);
        await act(async () => {
          await renderForm({ formId: 'f1' });
        });

        await screen.findByTestId('post-submission-tab');
        const order = tabOrder();
        expect(order.indexOf('post-submission-tab')).toBe(order.indexOf('settings-tab') + 1);
        // A grant to the form's workspace counts, so the check names both.
        expect(availability.check).toHaveBeenCalledWith('post-submission', {
          workspaceId: 'ws1',
          formId: 'f1',
        });
      });

      it('hides the tab while the check runs and once it answers no', async () => {
        inWorkspace(['*'], false);
        let answer: (available: boolean) => void = () => undefined;
        availability.check.mockReturnValue(
          new Promise<boolean>((resolve) => {
            answer = resolve;
          }),
        );
        await act(async () => {
          await renderForm({ formId: 'f1' });
        });

        await waitFor(() => expect(availability.check).toHaveBeenCalled());
        expect(screen.getByTestId('settings-tab')).toBeInTheDocument();
        expect(screen.queryByTestId('post-submission-tab')).not.toBeInTheDocument();

        await act(async () => answer(false));
        expect(screen.getByTestId('settings-tab')).toBeInTheDocument();
        expect(screen.queryByTestId('post-submission-tab')).not.toBeInTheDocument();
      });

      it('hides the tab, and asks nothing, without the Settings permission', async () => {
        inWorkspace(['design_update'], true);
        await act(async () => {
          await renderForm({ formId: 'f1' });
        });

        expect(await screen.findByTestId('designer-tab')).toBeInTheDocument();
        expect(screen.queryByTestId('post-submission-tab')).not.toBeInTheDocument();
        expect(availability.check).not.toHaveBeenCalled();
      });

      it('opens the tab a link names once the check answers, without opening the builder first', async () => {
        session.search = 'tab=post-submission';
        inWorkspace(['*'], true);
        await act(async () => {
          await renderForm({ formId: 'f1' });
        });

        expect(await screen.findByTestId('post-submission-tab')).toHaveAttribute(
          'aria-selected',
          'true',
        );
        expect(screen.getByTestId('post-submission-content')).toBeInTheDocument();
        expect(screen.queryByTestId('form-designer')).not.toBeInTheDocument();
      });

      it('opens the first visible tab when a link names the tab and it is not available', async () => {
        session.search = 'tab=post-submission';
        inWorkspace(['*'], false);
        await act(async () => {
          await renderForm({ formId: 'f1' });
        });

        expect(await screen.findByTestId('designer-tab')).toHaveAttribute('aria-selected', 'true');
        expect(screen.queryByTestId('post-submission-tab')).not.toBeInTheDocument();
      });
    });

    describe('Jobs', () => {
      it('sits last before Share', async () => {
        await act(async () => {
          await renderForm({ formId: 'f1' });
        });

        await screen.findByTestId('jobs-tab');
        const order = screen.getAllByRole('tab').map((tab) => tab.getAttribute('data-testid'));
        expect(order.slice(-3)).toEqual(['submission-tab', 'jobs-tab', 'share-tab']);
      });

      it('opens the tab a link names, which a job page links back to', async () => {
        session.search = 'tab=jobs';
        await act(async () => {
          await renderForm({ formId: 'f1' });
        });

        expect(await screen.findByTestId('jobs-tab')).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByTestId('jobs-content')).toBeInTheDocument();
        expect(screen.queryByTestId('form-designer')).not.toBeInTheDocument();
      });

      it('stays open when the form schema cannot be read, as jobs do not depend on it', async () => {
        mockWorkspaceState.versions = [{ id: 'v1', versionNo: 1, state: 'draft' }];
        api.getFormVersionSchema.mockRejectedValue(new Error('boom'));
        await act(async () => {
          await renderForm({ formId: 'f1' });
        });

        await screen.findByTestId('designer-load-error');
        expect(screen.getByTestId('jobs-tab')).not.toHaveAttribute('aria-disabled', 'true');
        expect(screen.getByTestId('settings-tab')).toHaveAttribute('aria-disabled', 'true');
      });
    });

    // Back from a page a tab opened, such as a job's, returns to that tab.
    it('writes the chosen tab into the URL under the base path, keeping the lists params', async () => {
      vi.stubEnv('NEXT_PUBLIC_BASE_PATH', '/chefs');
      session.path = '/en/build/f1';
      window.history.replaceState(null, '', '/chefs/en/build/f1?formSubmissions.page=2');
      const replaceState = vi.spyOn(window.history, 'replaceState');
      await act(async () => {
        await renderForm({ formId: 'f1' });
      });

      await userEvent.click(await screen.findByTestId('jobs-tab'));

      expect(replaceState).toHaveBeenLastCalledWith(
        null,
        '',
        '/chefs/en/build/f1?formSubmissions.page=2&tab=jobs',
      );
      replaceState.mockRestore();
      vi.unstubAllEnvs();
      window.history.replaceState(null, '', '/');
    });
  });
});
