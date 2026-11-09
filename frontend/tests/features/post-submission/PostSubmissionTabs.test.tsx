import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { SWRConfig } from 'swr';
import en from '@/dictionaries/en.json';
import type { Dictionary } from '@/src/types/dictionary';
import { ApiError } from '@/src/shared/api/sobaHelpers';

const { mockGetFormSettings, mockGetWorkspaceSettings } = vi.hoisted(() => ({
  mockGetFormSettings: vi.fn(),
  mockGetWorkspaceSettings: vi.fn(),
}));

vi.mock('@/src/features/form-settings/data/api', () => ({
  getFormSettings: mockGetFormSettings,
  getWorkspaceSettings: mockGetWorkspaceSettings,
  setFormSettings: vi.fn(),
  setWorkspaceSettings: vi.fn(),
}));

vi.mock('@/lib/hooks/useNotificationStore', () => ({
  useNotificationStore: () => ({ addNotification: vi.fn() }),
}));

// The loading spinner reads the dictionary from the page's providers.
vi.mock('@/app/[lang]/Providers', async () => {
  const dictionary = (await import('@/dictionaries/en.json')).default;
  return { useDictionary: () => dictionary };
});

import makeStore from '@/lib/store';
import { setAuthenticated, setToken } from '@/lib/slices/keycloakSlice';
import FormPostSubmissionTab from '@/src/features/post-submission/ui/FormPostSubmissionTab';
import WorkspacePostSubmissionTab from '@/src/features/post-submission/ui/WorkspacePostSubmissionTab';

const dict: Dictionary = en;
const OFF = { enabled: false, options: {} };
const formView = { inherit: true, own: null, workspace: OFF, effective: OFF, version: 0 };

let store: ReturnType<typeof makeStore>;

const renderTab = (tab: React.ReactNode) =>
  render(
    <Provider store={store}>
      <SWRConfig
        value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}
      >
        {tab}
      </SWRConfig>
    </Provider>,
  );

describe('After Submission tabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store = makeStore();
    store.dispatch(setToken('token'));
    store.dispatch(setAuthenticated(true));
    // Each drawer's own read; these tests are about the list around them.
    mockGetFormSettings.mockImplementation((_token, _form, key: string) =>
      Promise.resolve(key === 'post-submission' ? { actions: [] } : formView),
    );
  });

  it("lists a form's actions in the server's order, under the form's intro", async () => {
    mockGetFormSettings.mockImplementation((_token, _form, key: string) =>
      Promise.resolve(
        key === 'post-submission'
          ? {
              actions: ['post-submission-email-addresses', 'post-submission-log'].map((code) => ({
                code,
                name: code,
                scopes: ['workspace', 'form'],
                workspaceConfigurable: true,
                settings: formView,
              })),
            }
          : formView,
      ),
    );
    renderTab(<FormPostSubmissionTab dict={dict} formId="f1" />);

    expect(await screen.findByTestId('post-submission-intro')).toHaveTextContent(
      en.postSubmission.formIntro,
    );
    const drawers = screen.getAllByTestId(/^accordion-post-submission-/);
    expect(drawers.map((drawer) => drawer.dataset.testid)).toEqual([
      'accordion-post-submission-email-addresses',
      'accordion-post-submission-log',
    ]);
    expect(mockGetFormSettings).toHaveBeenCalledWith('token', 'f1', 'post-submission');
  });

  it('says an administrator gives access when nothing is listed', async () => {
    renderTab(<FormPostSubmissionTab dict={dict} formId="f1" />);
    expect(await screen.findByTestId('post-submission-empty')).toHaveTextContent(
      en.postSubmission.empty,
    );
  });

  it('says After Submission is not available when the list is not found', async () => {
    mockGetFormSettings.mockRejectedValue(new ApiError('Not found', 404));
    renderTab(<FormPostSubmissionTab dict={dict} formId="f1" />);
    expect(await screen.findByTestId('post-submission-load-error')).toHaveTextContent(
      en.postSubmission.notAvailable,
    );
  });

  it('says the list did not load on any other failure', async () => {
    mockGetFormSettings.mockRejectedValue(new ApiError('Boom', 500));
    renderTab(<FormPostSubmissionTab dict={dict} formId="f1" />);
    expect(await screen.findByTestId('post-submission-load-error')).toHaveTextContent(
      en.postSubmission.loadError,
    );
  });

  it("says where a form's unknown workspace-only action is set", async () => {
    mockGetFormSettings.mockImplementation((_token, _form, key: string) =>
      Promise.resolve(
        key === 'post-submission'
          ? {
              actions: [
                {
                  code: 'post-submission-zip',
                  name: 'Zip the files',
                  scopes: ['workspace'],
                  workspaceConfigurable: true,
                  settings: formView,
                },
              ],
            }
          : formView,
      ),
    );
    renderTab(<FormPostSubmissionTab dict={dict} formId="f1" />);

    expect(await screen.findByTestId('post-submission-zip-unknown-note')).toHaveTextContent(
      en.postSubmission.workspaceOnlyNote,
    );
  });

  it('shows an action this build has no fields for as a read-only card', async () => {
    mockGetWorkspaceSettings.mockResolvedValue({
      actions: [
        {
          code: 'post-submission-zip',
          name: 'Zip the files',
          description: 'Zips the files of each submission',
          scopes: ['workspace'],
          settings: { values: { enabled: true, options: {} }, version: 2 },
        },
      ],
    });
    renderTab(<WorkspacePostSubmissionTab dict={dict} workspaceId="ws1" />);

    const card = await screen.findByTestId('post-submission-zip-unknown');
    expect(card).toHaveTextContent('Zips the files of each submission');
    expect(card).toHaveTextContent('Status: On');
    expect(card).toHaveTextContent(en.postSubmission.unknownAction);
    expect(screen.queryByTestId('post-submission-zip-unknown-note')).not.toBeInTheDocument();
    expect(screen.getByTestId('post-submission-intro')).toHaveTextContent(
      en.postSubmission.workspaceIntro,
    );
  });
});
