import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FormCreateContent } from '@/src/features/designer/ui/FormCreateContent';
import { ApiError } from '@/src/shared/api/sobaHelpers';

const mockRouterPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({ push: mockRouterPush })),
  useParams: () => ({ lang: 'en' }),
}));

vi.mock('@/lib/hooks/useKeycloak', () => ({
  useKeycloak: () => ({ token: 'mock-token' }),
}));

vi.mock('@/app/[lang]/Providers', () => ({
  useDictionary: () => ({
    form: {
      nameLabel: 'Form Name',
      noActiveWorkspaceError: 'Select a workspace before saving this form.',
      noFormName: 'Enter a form name.',
      saved: 'Form saved successfully.',
      saveError: 'Failed to save form.',
      versionConflict: 'Version conflict.',
      disclaimerRequired: 'Accept the workspace disclaimer before creating a form.',
      noActiveWorkspace: 'No active workspace.',
      settings: {
        inheritWorkspaceLabel: 'Use the workspace setting',
        audienceLabel: 'Who can submit',
        audiencePublic: 'Public',
        audienceProtected: 'Protected',
        audienceMembers: 'Members only',
        audienceProviders: 'Allowed logins',
        audienceProvidersRequired: 'Select at least one login.',
        audienceLoadError: 'Could not load the form audience.',
      },
    },
    general: {
      cancel: 'Cancel',
      next: 'Next',
      lookupTruncated: 'Showing truncated.',
      noAccess: 'You do not have access to this.',
      sessionExpired: 'Your session has ended.',
    },
    workspaces: {
      workspace: 'Workspace',
    },
  }),
}));

const mockAddNotification = vi.fn();
vi.mock('@/lib/hooks/useNotificationStore', () => ({
  useNotificationStore: () => ({
    addNotification: mockAddNotification,
  }),
}));

const mockCreateSobaFormioForm = vi.fn();
vi.mock('@/src/shared/api/sobaApi', () => ({
  createSobaFormioForm: (...args: unknown[]) => mockCreateSobaFormioForm(...args),
}));

vi.mock('@/src/shared/api/useCurrentUser', () => ({
  useCurrentUser: vi.fn(),
}));

vi.mock('@/src/shared/api/useWorkspaces', () => ({
  useFormCreateWorkspaceOptions: vi.fn(),
}));

vi.mock('@/src/features/form-settings/data/useWorkspaceSettings', () => ({
  useFreshWorkspaceSettings: vi.fn(),
}));

vi.mock('@/src/shared/api/useLoginProviders', () => ({
  useLoginProviders: vi.fn(),
}));

vi.mock('@/app/ui/WorkspaceSelector', () => ({
  WorkspaceSelector: ({
    selectedWorkspaceId,
    onChange,
    workspaces,
    label,
  }: {
    selectedWorkspaceId: string | null;
    onChange: (id: string) => void;
    workspaces: Array<{ id: string; name: string }>;
    label: string;
  }) => (
    <div>
      <label>{label}</label>
      <select
        data-testid="workspace-selector"
        value={selectedWorkspaceId || ''}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Select workspace</option>
        {workspaces.map((w: { id: string; name: string }) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
      </select>
    </div>
  ),
}));

import type { Mock } from 'vitest';
import { useCurrentUser } from '@/src/shared/api/useCurrentUser';
import { useFormCreateWorkspaceOptions } from '@/src/shared/api/useWorkspaces';
import { useFreshWorkspaceSettings } from '@/src/features/form-settings/data/useWorkspaceSettings';
import { useLoginProviders } from '@/src/shared/api/useLoginProviders';
import { classifyDataError } from '@/src/shared/api/dataError';

const PROVIDERS = [
  { code: 'azureidir', name: 'IDIR - MFA' },
  { code: 'bceidbusiness', name: 'BCeID Business' },
];
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
// The form and its first version, as ids the browser mints.
const minted = { id: expect.stringMatching(UUID_V7), versionId: expect.stringMatching(UUID_V7) };

const workspaceAudiences: Record<string, unknown> = {
  'ws-1': { mode: 'protected', idps: ['azureidir'] },
  'ws-2': { mode: 'members', idps: [] },
};

describe('FormCreateContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useCurrentUser as Mock).mockReturnValue({
      data: { capabilities: { formCreate: 'allowed' } },
      loaded: true,
    });
    (useFormCreateWorkspaceOptions as Mock).mockReturnValue({
      workspaces: [
        { id: 'ws-1', name: 'Workspace 1', role: 'owner' },
        { id: 'ws-2', name: 'Workspace 2', role: 'editor' },
      ],
      truncated: false,
    });
    mockCreateSobaFormioForm.mockResolvedValue({
      value: { id: 'form-123', formVersion: { id: 'v-1', versionNo: 1, state: 'draft' } },
      created: true,
    });
    (useFreshWorkspaceSettings as Mock).mockImplementation(
      (_key: string, workspaceId: string | null) => ({
        settings: workspaceId ? { values: workspaceAudiences[workspaceId], version: 1 } : undefined,
        error: null,
      }),
    );
    (useLoginProviders as Mock).mockReturnValue({
      data: PROVIDERS,
      isLoading: false,
      error: null,
      refresh: vi.fn(),
    });
  });

  const renderComponent = () => render(<FormCreateContent onCancelPress={vi.fn()} />);

  const nameInput = () =>
    screen.getByTestId('form-name-modal').querySelector('input') as HTMLInputElement;

  it('renders form name input and workspace selector', () => {
    renderComponent();
    expect(screen.getByTestId('form-name-modal')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-selector')).toBeInTheDocument();
  });

  // The name is a required field, so a blank one is reported on the field and never reaches the
  // backend, which rejects it with a generic error.
  it.each([
    ['empty', ''],
    ['blank', '   '],
  ])('reports a %s form name on the field and does not create', async (_label, value) => {
    renderComponent();
    await userEvent.selectOptions(screen.getByTestId('workspace-selector'), 'ws-1');
    if (value) {
      await userEvent.type(nameInput(), value);
    }

    await userEvent.click(screen.getByTestId('save-create-form'));

    expect(await screen.findByText('Enter a form name.')).toBeInTheDocument();
    expect(mockCreateSobaFormioForm).not.toHaveBeenCalled();
  });

  it('shows notification if workspace is not selected on save', async () => {
    renderComponent();
    const saveButton = screen.getByTestId('save-create-form');

    await userEvent.type(nameInput(), 'My New Form');

    await userEvent.click(saveButton);
    expect(mockAddNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Select a workspace before saving this form.',
        type: 'error',
      }),
    );
  });

  it('creates form successfully and redirects', async () => {
    renderComponent();

    await userEvent.type(nameInput(), 'My New Form');

    // Select workspace
    const select = screen.getByTestId('workspace-selector');
    await userEvent.selectOptions(select, 'ws-1');

    const saveButton = screen.getByTestId('save-create-form');
    await userEvent.click(saveButton);

    expect(mockCreateSobaFormioForm).toHaveBeenCalledWith(
      'mock-token',
      { name: 'My New Form', ...minted },
      'ws-1',
    );
    expect(mockAddNotification).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Form saved successfully.', type: 'success' }),
    );
    expect(mockRouterPush).toHaveBeenCalledWith('/en/build/form-123');
  });

  // A retry with the same ids returns the form the first attempt made, rather than a second one, even
  // after the name was edited.
  it('sends the same ids when a failed create is tried again after an edit', async () => {
    mockCreateSobaFormioForm.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    renderComponent();

    await userEvent.type(nameInput(), 'My New Form');
    await userEvent.selectOptions(screen.getByTestId('workspace-selector'), 'ws-1');
    await userEvent.click(screen.getByTestId('save-create-form'));
    await userEvent.type(nameInput(), ' 2');
    await userEvent.click(screen.getByTestId('save-create-form'));

    expect(mockCreateSobaFormioForm).toHaveBeenCalledTimes(2);
    const [first, second] = mockCreateSobaFormioForm.mock.calls.map((call) => call[1]);
    expect(second).toEqual({ ...first, name: 'My New Form 2' });
    expect(mockRouterPush).toHaveBeenCalledWith('/en/build/form-123');
  });

  // Another workspace is another form, so a retry there is not matched to the first attempt.
  it('mints new ids when a failed create is tried again in another workspace', async () => {
    mockCreateSobaFormioForm.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    renderComponent();

    await userEvent.type(nameInput(), 'My New Form');
    await userEvent.selectOptions(screen.getByTestId('workspace-selector'), 'ws-1');
    await userEvent.click(screen.getByTestId('save-create-form'));
    await userEvent.selectOptions(screen.getByTestId('workspace-selector'), 'ws-2');
    await userEvent.click(screen.getByTestId('save-create-form'));

    const [first, second] = mockCreateSobaFormioForm.mock.calls.map((call) => call[1]);
    expect(second.id).not.toBe(first.id);
    expect(second.versionId).not.toBe(first.versionId);
  });

  it('sends the name without surrounding whitespace', async () => {
    renderComponent();

    await userEvent.type(nameInput(), '  My New Form  ');
    await userEvent.selectOptions(screen.getByTestId('workspace-selector'), 'ws-1');
    await userEvent.click(screen.getByTestId('save-create-form'));

    expect(mockCreateSobaFormioForm).toHaveBeenCalledWith(
      'mock-token',
      { name: 'My New Form', ...minted },
      'ws-1',
    );
  });

  // A 409 here means the name is taken or the disclaimer is unaccepted, so the backend's own
  // message is the useful one. Nothing in this dialog has versions to conflict over.
  it('reports the reason a conflicting create was refused', async () => {
    mockCreateSobaFormioForm.mockRejectedValue(
      new ApiError('A form with this name already exists in this workspace.', 409),
    );
    renderComponent();

    await userEvent.type(nameInput(), 'My New Form');
    await userEvent.selectOptions(screen.getByTestId('workspace-selector'), 'ws-1');
    await userEvent.click(screen.getByTestId('save-create-form'));

    expect(mockAddNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'A form with this name already exists in this workspace.',
        type: 'error',
      }),
    );
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it('falls back to the generic message when a create fails without one', async () => {
    mockCreateSobaFormioForm.mockRejectedValue(new ApiError('', 500));
    renderComponent();

    await userEvent.type(nameInput(), 'My New Form');
    await userEvent.selectOptions(screen.getByTestId('workspace-selector'), 'ws-1');
    await userEvent.click(screen.getByTestId('save-create-form'));

    expect(mockAddNotification).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Failed to save form.', type: 'error' }),
    );
  });

  it('shows disclaimer required warning if user capability is disclaimer_required', () => {
    (useCurrentUser as Mock).mockReturnValue({
      data: { capabilities: { formCreate: 'disclaimer_required' } },
      loaded: true,
    });
    renderComponent();
    expect(screen.getByTestId('disclaimer-required-alert')).toBeInTheDocument();
  });

  it('shows no workspace warning if user capability is not allowed', () => {
    (useCurrentUser as Mock).mockReturnValue({
      data: { capabilities: { formCreate: 'not_allowed' } },
      loaded: true,
    });
    renderComponent();
    expect(screen.getByTestId('designer-select-workspace')).toBeInTheDocument();
  });

  describe('who can submit', () => {
    const input = (testId: string) =>
      screen.getByTestId(testId).querySelector('input') as HTMLInputElement;

    const chooseWorkspace = async (id = 'ws-1') => {
      await userEvent.type(nameInput(), 'My New Form');
      await userEvent.selectOptions(screen.getByTestId('workspace-selector'), id);
    };

    it('asks nothing until a workspace is chosen', () => {
      renderComponent();
      expect(screen.queryByTestId('create-form-audience')).not.toBeInTheDocument();
    });

    it("inherits the workspace's audience by default and sends no settings", async () => {
      renderComponent();
      await chooseWorkspace();

      expect(input('create-form-audience-inherit')).toBeChecked();
      expect(input('audience-mode-protected')).toBeChecked();
      expect(input('audience-mode-protected')).toBeDisabled();
      await userEvent.click(screen.getByTestId('save-create-form'));

      expect(mockCreateSobaFormioForm).toHaveBeenCalledWith(
        'mock-token',
        { name: 'My New Form', ...minted },
        'ws-1',
      );
    });

    it('creates the form with its own audience', async () => {
      renderComponent();
      await chooseWorkspace();

      await userEvent.click(screen.getByText('Use the workspace setting'));
      await userEvent.click(screen.getByText('Members only'));
      await userEvent.click(screen.getByTestId('save-create-form'));

      expect(mockCreateSobaFormioForm).toHaveBeenCalledWith(
        'mock-token',
        {
          name: 'My New Form',
          ...minted,
          settings: { audience: { inherit: false, values: { mode: 'members', idps: [] } } },
        },
        'ws-1',
      );
    });

    it('needs a login before a protected audience is created', async () => {
      renderComponent();
      await chooseWorkspace('ws-2');

      await userEvent.click(screen.getByText('Use the workspace setting'));
      await userEvent.click(screen.getByText('Protected'));
      expect(screen.getByTestId('save-create-form')).toBeDisabled();

      await userEvent.click(screen.getByText('BCeID Business'));
      expect(screen.getByTestId('save-create-form')).toBeEnabled();
    });

    // The form would inherit an audience the creator was never shown.
    it('keeps Next off while the workspace audience loads', async () => {
      (useFreshWorkspaceSettings as Mock).mockReturnValue({ settings: undefined, error: null });
      renderComponent();
      await chooseWorkspace();

      expect(screen.getByTestId('save-create-form')).toBeDisabled();
      expect(screen.queryByTestId('create-form-audience-error')).not.toBeInTheDocument();
    });

    it.each([
      ['the workspace audience', 'settings'],
      ['the logins', 'providers'],
    ])('says when %s cannot be read and keeps Next off', async (_label, failing) => {
      const failed = classifyDataError(new ApiError('Boom', 500));
      if (failing === 'settings') {
        (useFreshWorkspaceSettings as Mock).mockReturnValue({ settings: undefined, error: failed });
      } else {
        (useLoginProviders as Mock).mockReturnValue({ data: undefined, error: failed });
      }
      renderComponent();
      await chooseWorkspace();

      expect(screen.getByTestId('create-form-audience-error')).toHaveTextContent(
        'Could not load the form audience.',
      );
      expect(screen.getByTestId('save-create-form')).toBeDisabled();
    });

    it('starts from the new workspace when the workspace changes', async () => {
      renderComponent();
      await chooseWorkspace();
      await userEvent.click(screen.getByText('Use the workspace setting'));
      await userEvent.click(screen.getByText('Public'));

      await userEvent.selectOptions(screen.getByTestId('workspace-selector'), 'ws-2');

      expect(input('create-form-audience-inherit')).toBeChecked();
      expect(input('audience-mode-members')).toBeChecked();
    });
  });
});
