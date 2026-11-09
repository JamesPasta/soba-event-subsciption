import React, { act } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { SWRConfig } from 'swr';

const mockPush = vi.fn();
const {
  mockCreateWorkspace,
  mockUpdateWorkspace,
  mockSelectWorkspace,
  mockCheckWorkspaceNameAvailable,
  mockRefreshWorkspaces,
  mockRefreshCurrentUser,
  mockSearchParams,
  mockAddNotification,
} = vi.hoisted(() => ({
  mockCreateWorkspace: vi.fn(),
  mockUpdateWorkspace: vi.fn(),
  mockSelectWorkspace: vi.fn(),
  mockCheckWorkspaceNameAvailable: vi.fn().mockResolvedValue({ available: true }),
  mockRefreshWorkspaces: vi.fn().mockResolvedValue([]),
  mockRefreshCurrentUser: vi.fn().mockResolvedValue(undefined),
  mockSearchParams: { value: '' },
  mockAddNotification: vi.fn(),
}));

vi.mock('@/lib/hooks/useKeycloak', () => ({
  useKeycloak: () => ({ authenticated: true, token: 'token', initializing: false }),
}));

vi.mock('@/app/[lang]/Providers', () => ({
  useDictionary: () => ({
    locale: 'en',
    general: {
      notAuthenticated: 'Not authed',
      loading: 'Loading…',
    },
    ministries: {
      testOrg: 'Test Org',
    },
    useCases: {
      testUseCase: 'Test Use Case',
    },
    // internal_error is unrelated to workspace saves, so a test can tell "the specific
    // workspace_name_taken wording" apart from "the generic apiErrors text for some other code".
    apiErrors: {
      internal_error: 'Something went wrong. Please try again.',
      workspace_name_taken: 'A workspace with this name already exists.',
    },
    workspaces: {
      createHeading: 'Create Workspace',
      manageHeading: 'Manage Workspace',
      settingsTab: 'Settings',
      formSettingsTab: 'Form Settings',
      groupsTab: 'Groups',
      nameLabel: 'Name',
      save: 'Save',
      create: 'Create',
      cancel: 'Cancel',
      saveError: 'Failed to save workspace.',
      createError: 'Failed to create workspace.',
      nameChecking: 'Checking…',
      nameAvailable: 'Available',
      nameUnavailable: 'Unavailable',
      loadError: 'Failed to load workspace.',
      manageForbidden: 'Only workspace owners or admins can manage this workspace.',
      createForbidden: 'Only BC Government identity provider users can create workspaces.',
      disclaimerLabel: 'I agree to the disclaimer and statement of responsibility',
    },
    postSubmission: { tab: 'After Submission' },
    jobs: { heading: 'Jobs' },
  }),
}));

// Whether post-submission is available, as the server would answer for the workspace.
const availability = vi.hoisted(() => ({ check: vi.fn() }));

vi.mock('@/src/shared/featureFlags/featureAvailability', () => ({
  fetchFeatureAvailability: availability.check,
}));

vi.mock('@/src/features/post-submission/ui/WorkspacePostSubmissionTab', () => ({
  default: () => <div data-testid="workspace-post-submission-content" />,
}));

vi.mock('@/src/features/jobs/ui/ScopedJobsTabs', () => ({
  WorkspaceJobsTab: () => <div data-testid="workspace-jobs-content" />,
}));

vi.mock('@bcgov/design-system-react-components', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@bcgov/design-system-react-components')>();

  type SelectItem = { id: string | number; label: string };

  return {
    ...actual,
    Select: ({
      'data-testid': testId,
      value,
      onChange,
      items,
      isDisabled,
    }: {
      'data-testid'?: string;
      value?: string | number | null;
      onChange?: (val: string) => void;
      items?: SelectItem[];
      isDisabled?: boolean;
    }) => (
      <select
        data-testid={testId}
        value={value ?? ''}
        onChange={(e) => onChange?.(e.target.value)}
        aria-label={testId}
        disabled={isDisabled}
      >
        <option value="">Select...</option>
        {items?.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </select>
    ),
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
  usePathname: () => '/en/workspace',
  useSearchParams: () => new URLSearchParams(mockSearchParams.value),
}));

vi.mock('@/src/features/workspaces/ui/WorkspaceGroupTab', () => ({
  default: () => <div data-testid="workspace-groups-tab-content">Workspace Groups Content</div>,
  WorkspaceGroupTab: () => (
    <div data-testid="workspace-groups-tab-content">Workspace Groups Content</div>
  ),
}));

vi.mock('@/src/features/form-settings/ui/WorkspaceFormSettings', () => ({
  default: () => (
    <div data-testid="workspace-form-settings-tab-content">Workspace Form Settings</div>
  ),
}));

vi.mock('@/src/shared/api/useWorkspaces', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/shared/api/useWorkspaces')>()),
  useRefreshWorkspaces: () => mockRefreshWorkspaces,
}));

vi.mock('@/src/shared/api/useCurrentUser', () => ({
  useCurrentUser: () => ({
    data: { capabilities: { canCreateWorkspace: true } },
    loaded: true,
  }),
  useRefreshCurrentUser: () => mockRefreshCurrentUser,
}));

vi.mock('@/lib/hooks/useNotificationStore', () => ({
  useNotificationStore: () => ({ addNotification: mockAddNotification }),
}));

vi.mock('@/src/shared/api/sobaApi', () => ({
  createWorkspace: mockCreateWorkspace,
  updateWorkspace: mockUpdateWorkspace,
  selectWorkspace: mockSelectWorkspace,
  checkWorkspaceNameAvailable: mockCheckWorkspaceNameAvailable,
}));

import { ApiError } from '@/src/shared/api/sobaHelpers';
import makeStore from '@/lib/store';
import { setAuthenticated, setToken } from '@/lib/slices/keycloakSlice';
import WorkspaceForm from '@/src/features/workspaces/ui/WorkspaceForm';

let store: ReturnType<typeof makeStore>;

function renderForm(workspaceId?: string) {
  return render(
    <Provider store={store}>
      <SWRConfig
        value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}
      >
        <WorkspaceForm workspaceId={workspaceId} />
      </SWRConfig>
    </Provider>,
  );
}

describe('WorkspaceForm', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams.value = '';
    store = makeStore();
    store.dispatch(setToken('token'));
    store.dispatch(setAuthenticated(true));
    availability.check.mockResolvedValue(false);
    mockCreateWorkspace.mockResolvedValue({
      id: 'ws-new',
      name: 'New Team',
      kind: 'team',
      role: 'owner',
      status: 'active',
    });
    mockSelectWorkspace.mockResolvedValue({
      id: 'ws2',
      name: 'Team Workspace',
      kind: 'team',
      role: 'owner',
      status: 'active',
      disclaimerAccepted: false,
      useCase: 'testUseCase',
      org: 'testOrg',
    });
    mockUpdateWorkspace.mockResolvedValue({
      id: 'ws2',
      name: 'Renamed',
      kind: 'team',
      role: 'owner',
      status: 'active',
      disclaimerAccepted: false,
      useCase: 'testUseCase',
      org: 'testOrg',
    });
  });

  it('create mode renders empty name and does not load workspace', async () => {
    await act(async () => {
      renderForm();
    });
    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(mockSelectWorkspace).not.toHaveBeenCalled();
  });

  it('manage mode loads workspace name', async () => {
    await act(async () => {
      renderForm('ws2');
    });
    expect(await screen.findByDisplayValue('Team Workspace')).toBeInTheDocument();
    expect(mockSelectWorkspace).toHaveBeenCalledWith('token', 'ws2');
  });

  it('manage mode shows the Settings and Form Settings tabs', async () => {
    await act(async () => {
      renderForm('ws2');
    });
    await waitFor(() => expect(mockSelectWorkspace).toHaveBeenCalled());
    expect(screen.getByRole('tab', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Form Settings' })).toBeInTheDocument();
  });

  it('manage mode shows the After Submission tab after Form Settings where post-submission is available', async () => {
    availability.check.mockResolvedValue(true);
    await act(async () => {
      renderForm('ws2');
    });

    expect(await screen.findByTestId('workspace-post-submission-tab')).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Settings',
      'Form Settings',
      'After Submission',
      'Groups',
      'Jobs',
    ]);
    expect(availability.check).toHaveBeenCalledWith('post-submission', { workspaceId: 'ws2' });
  });

  it('manage mode shows the Jobs tab to the owner, and opens it when a link names it', async () => {
    mockSearchParams.value = 'tab=jobs';
    await act(async () => {
      renderForm('ws2');
    });

    expect(await screen.findByTestId('workspace-jobs-tab')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByTestId('workspace-jobs-content')).toBeInTheDocument();
  });

  it('manage mode hides the Jobs tab from a workspace admin', async () => {
    mockSearchParams.value = 'tab=jobs';
    mockSelectWorkspace.mockResolvedValue({
      id: 'ws2',
      name: 'Team Workspace',
      kind: 'team',
      role: 'admin',
      status: 'active',
      disclaimerAccepted: false,
      useCase: 'testUseCase',
      org: 'testOrg',
    });
    await act(async () => {
      renderForm('ws2');
    });

    expect(await screen.findByRole('tab', { name: 'Settings' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.queryByTestId('workspace-jobs-tab')).not.toBeInTheDocument();
  });

  it('manage mode hides the After Submission tab while the check runs and once it answers no', async () => {
    let answer: (available: boolean) => void = () => undefined;
    availability.check.mockReturnValue(
      new Promise<boolean>((resolve) => {
        answer = resolve;
      }),
    );
    await act(async () => {
      renderForm('ws2');
    });

    await waitFor(() => expect(availability.check).toHaveBeenCalled());
    expect(screen.queryByTestId('workspace-post-submission-tab')).not.toBeInTheDocument();

    await act(async () => answer(false));
    expect(screen.getByRole('tab', { name: 'Form Settings' })).toBeInTheDocument();
    expect(screen.queryByTestId('workspace-post-submission-tab')).not.toBeInTheDocument();
  });

  it('save on create posts the workspace', async () => {
    await act(async () => {
      renderForm();
    });
    await userEvent.selectOptions(screen.getByTestId('workspace-your-org'), 'testOrg');
    await userEvent.type(screen.getByRole('textbox'), 'New Team');
    await userEvent.selectOptions(screen.getByTestId('workspace-use-case'), 'testUseCase');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(mockCreateWorkspace).toHaveBeenCalledWith('token', {
        name: 'New Team',
        disclaimerAccepted: false,
        useCase: 'testUseCase',
        org: 'testOrg',
      });
      expect(mockPush).toHaveBeenCalledWith('/en/workspaces?from=nav');
    });
  });

  it('save on create sends the disclaimer acceptance', async () => {
    await act(async () => {
      renderForm();
    });
    await userEvent.selectOptions(screen.getByTestId('workspace-your-org'), 'testOrg');
    await userEvent.type(screen.getByRole('textbox'), 'New Team');
    await userEvent.selectOptions(screen.getByTestId('workspace-use-case'), 'testUseCase');
    await userEvent.click(screen.getByTestId('workspace-disclaimer-switch'));
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(mockCreateWorkspace).toHaveBeenCalledWith('token', {
        name: 'New Team',
        disclaimerAccepted: true,
        useCase: 'testUseCase',
        org: 'testOrg',
      });
    });
  });

  it('disables the name field until an organization is selected', async () => {
    await act(async () => {
      renderForm();
    });
    expect(screen.getByRole('textbox')).toBeDisabled();
    await userEvent.selectOptions(screen.getByTestId('workspace-your-org'), 'testOrg');
    expect(screen.getByRole('textbox')).not.toBeDisabled();
  });

  it('shows a live availability indicator as the name is typed', async () => {
    await act(async () => {
      renderForm();
    });
    await userEvent.selectOptions(screen.getByTestId('workspace-your-org'), 'testOrg');
    await userEvent.type(screen.getByRole('textbox'), 'New');

    expect(await screen.findByText('Available ✓')).toBeInTheDocument();
    // Announced too: the description under the field isn't a live region.
    expect(screen.getByTestId('workspace-name-status')).toHaveTextContent('Available');
    expect(mockCheckWorkspaceNameAvailable).toHaveBeenCalledWith('token', {
      org: 'testOrg',
      name: 'New',
      excludeId: undefined,
    });
  });

  it('does not re-check the name after a successful create, even though it refreshes the workspace list', async () => {
    await act(async () => {
      renderForm();
    });
    await userEvent.selectOptions(screen.getByTestId('workspace-your-org'), 'testOrg');
    await userEvent.type(screen.getByRole('textbox'), 'New Team');
    await userEvent.selectOptions(screen.getByTestId('workspace-use-case'), 'testUseCase');
    expect(await screen.findByText('Available ✓')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    expect(mockCheckWorkspaceNameAvailable).toHaveBeenCalledTimes(1);
  });

  it('shows the name as unavailable and blocks save', async () => {
    mockCheckWorkspaceNameAvailable.mockResolvedValueOnce({ available: false });
    await act(async () => {
      renderForm();
    });
    await userEvent.selectOptions(screen.getByTestId('workspace-your-org'), 'testOrg');
    await userEvent.type(screen.getByRole('textbox'), 'Taken');
    await userEvent.selectOptions(screen.getByTestId('workspace-use-case'), 'testUseCase');

    expect(await screen.findByText('Unavailable ✕')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-name-status')).toHaveTextContent('Unavailable');
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
  });

  it('re-checks the name after a 409 and says the name is taken', async () => {
    mockCreateWorkspace.mockRejectedValueOnce(
      new ApiError('A workspace with this name already exists', 409, 'workspace_name_taken'),
    );
    await act(async () => {
      renderForm();
    });
    await userEvent.selectOptions(screen.getByTestId('workspace-your-org'), 'testOrg');
    await userEvent.type(screen.getByRole('textbox'), 'Taken Name');
    await userEvent.selectOptions(screen.getByTestId('workspace-use-case'), 'testUseCase');

    expect(await screen.findByText('Available ✓')).toBeInTheDocument();

    // Someone else claims the name between the last check and this save landing.
    mockCheckWorkspaceNameAvailable.mockResolvedValueOnce({ available: false });
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByText('Unavailable ✕')).toBeInTheDocument();
    expect(mockCheckWorkspaceNameAvailable).toHaveBeenCalledTimes(2);
    expect(mockAddNotification).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'A workspace with this name already exists.' }),
    );
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('shows the plain create-failed message for an error other than workspace_name_taken, not the generic apiErrors text', async () => {
    mockCreateWorkspace.mockRejectedValueOnce(
      new ApiError('Internal error', 500, 'internal_error'),
    );
    await act(async () => {
      renderForm();
    });
    await userEvent.selectOptions(screen.getByTestId('workspace-your-org'), 'testOrg');
    await userEvent.type(screen.getByRole('textbox'), 'New Team');
    await userEvent.selectOptions(screen.getByTestId('workspace-use-case'), 'testUseCase');
    expect(await screen.findByText('Available ✓')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(mockAddNotification).toHaveBeenCalled());
    expect(mockAddNotification).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Failed to create workspace.' }),
    );
  });

  it('manage mode does not check the workspace against its own unchanged name', async () => {
    await act(async () => {
      renderForm('ws2');
    });
    expect(await screen.findByDisplayValue('Team Workspace')).toBeInTheDocument();

    expect(screen.queryByText(/Checking|Available|Unavailable/)).not.toBeInTheDocument();
    expect(mockCheckWorkspaceNameAvailable).not.toHaveBeenCalled();
  });

  it('manage mode checks again once the name is actually edited, and stops once reverted', async () => {
    await act(async () => {
      renderForm('ws2');
    });
    const nameInput = await screen.findByDisplayValue('Team Workspace');

    await userEvent.type(nameInput, ' Two');
    expect(await screen.findByText('Available ✓')).toBeInTheDocument();
    expect(mockCheckWorkspaceNameAvailable).toHaveBeenCalledWith('token', {
      org: 'testOrg',
      name: 'Team Workspace Two',
      excludeId: 'ws2',
    });

    await userEvent.type(nameInput, '{backspace}{backspace}{backspace}{backspace}');
    await waitFor(() =>
      expect(screen.queryByText(/Checking|Available|Unavailable/)).not.toBeInTheDocument(),
    );
  });

  it('cancel navigates back without saving', async () => {
    await act(async () => {
      renderForm();
    });
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(mockCreateWorkspace).not.toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith('/en/workspaces?from=nav');
  });

  it('save on manage patches workspace when name changes', async () => {
    await act(async () => {
      renderForm('ws2');
    });
    expect(await screen.findByDisplayValue('Team Workspace')).toBeInTheDocument();
    const nameInput = screen.getByRole('textbox');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Renamed');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockUpdateWorkspace).toHaveBeenCalledWith('token', 'ws2', { name: 'Renamed' });
      expect(mockPush).toHaveBeenCalledWith('/en/workspaces?from=nav');
    });
  });

  // The fields seed once and the record behind them can move on, so sending the whole form would
  // carry the values this person was shown over anything edited elsewhere since.
  it('save on manage sends only the fields that changed', async () => {
    await act(async () => {
      renderForm('ws2');
    });
    expect(await screen.findByDisplayValue('Team Workspace')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('workspace-disclaimer-switch'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockUpdateWorkspace).toHaveBeenCalledWith('token', 'ws2', {
        disclaimerAccepted: true,
      });
    });
  });

  // Without the record the form would post its empty fields as a new workspace.
  it('withholds the form when the workspace cannot be loaded', async () => {
    mockSelectWorkspace.mockRejectedValue(new Error('boom'));

    await act(async () => {
      renderForm('ws2');
    });

    expect(await screen.findByTestId('workspace-load-error')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });

  it('sends a member who cannot manage the workspace back to the list', async () => {
    mockSelectWorkspace.mockResolvedValue({
      id: 'ws2',
      name: 'Team Workspace',
      kind: 'team',
      role: 'submitter',
      status: 'active',
      disclaimerAccepted: false,
      useCase: 'testUseCase',
      org: 'testOrg',
    });

    await act(async () => {
      renderForm('ws2');
    });

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/en/workspaces?from=nav'));
    expect(mockUpdateWorkspace).not.toHaveBeenCalled();
    expect(availability.check).not.toHaveBeenCalled();
  });

  // The record's own key too, not just the lists: the manage form seeds from it once and cannot
  // re-seed, so a stale copy would show the pre-save values on the next visit.
  it('re-reads the workspace after saving it', async () => {
    await act(async () => {
      renderForm('ws2');
    });
    expect(await screen.findByDisplayValue('Team Workspace')).toBeInTheDocument();
    expect(mockSelectWorkspace).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByTestId('workspace-disclaimer-switch'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockSelectWorkspace).toHaveBeenCalledTimes(2));
  });

  // A field left live during the write implies the change will be included. It will not: the
  // request body was built when Save was pressed.
  it('locks the fields while the save is in flight', async () => {
    let release: (() => void) | undefined;
    mockUpdateWorkspace.mockImplementation(
      () => new Promise<void>((resolve) => (release = () => resolve())),
    );

    await act(async () => {
      renderForm('ws2');
    });
    expect(await screen.findByDisplayValue('Team Workspace')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('workspace-disclaimer-switch'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockUpdateWorkspace).toHaveBeenCalled());
    expect(screen.getByTestId('workspace-your-org')).toBeDisabled();
    expect(screen.getByTestId('workspace-use-case')).toBeDisabled();
    // The testid lands on the design system's wrapper, so the control itself is the input inside.
    expect(screen.getByTestId('workspace-name').querySelector('input')).toBeDisabled();

    await act(async () => {
      release?.();
    });
  });

  // A disclaimer change moves whether the user can create a form, which the current user carries.
  // The writer refreshes the workspace lists and the current user together, so the current-user
  // refresh standing in confirms the post-save refresh ran.
  it('refreshes the current user after saving', async () => {
    await act(async () => {
      renderForm('ws2');
    });
    expect(await screen.findByDisplayValue('Team Workspace')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('workspace-disclaimer-switch'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockRefreshCurrentUser).toHaveBeenCalled());
  });

  it('switches to the groups tab when clicked without kicking back to settings', async () => {
    await act(async () => {
      renderForm('ws2');
    });
    expect(await screen.findByDisplayValue('Team Workspace')).toBeInTheDocument();

    const groupsTabButton = screen.getByRole('tab', { name: 'Groups' });
    expect(groupsTabButton).toBeInTheDocument();

    await userEvent.click(groupsTabButton);
    expect(await screen.findByTestId('workspace-groups-tab-content')).toBeInTheDocument();
  });

  it('keeps the base path in the URL it writes for the selected tab', async () => {
    vi.stubEnv('NEXT_PUBLIC_BASE_PATH', '/designer-230');
    const replaceState = vi.spyOn(window.history, 'replaceState');
    await act(async () => {
      renderForm('ws2');
    });
    expect(await screen.findByDisplayValue('Team Workspace')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Groups' }));
    expect(replaceState.mock.calls.at(-1)?.[2]).toBe('/designer-230/en/workspace?tab=groups');

    await userEvent.click(screen.getByRole('tab', { name: 'Settings' }));
    expect(replaceState.mock.calls.at(-1)?.[2]).toBe('/designer-230/en/workspace');
  });

  it('initializes to the groups tab if tab=groups is present in the URL query', async () => {
    mockSearchParams.value = 'tab=groups';
    await act(async () => {
      renderForm('ws2');
    });

    expect(await screen.findByTestId('workspace-groups-tab-content')).toBeInTheDocument();
  });

  it('opens After Submission from the URL query once the check says it is available', async () => {
    mockSearchParams.value = 'tab=post-submission';
    availability.check.mockResolvedValue(true);
    await act(async () => {
      renderForm('ws2');
    });

    expect(await screen.findByTestId('workspace-post-submission-content')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-post-submission-tab')).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('stays on Settings when the URL names After Submission and it is not available', async () => {
    mockSearchParams.value = 'tab=post-submission';
    await act(async () => {
      renderForm('ws2');
    });

    await waitFor(() => expect(availability.check).toHaveBeenCalled());
    expect(screen.getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByTestId('workspace-post-submission-tab')).not.toBeInTheDocument();
  });
});
