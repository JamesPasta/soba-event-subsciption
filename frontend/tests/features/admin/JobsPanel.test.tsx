import React, { act } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { SWRConfig } from 'swr';
import en from '@/dictionaries/en.json';
import type { JobListItem } from '@/src/types/admin';
import { WORKSPACE_ID, jobListItem, stubJobsServer, type Handler } from './jobsServer';

const { mockSearch } = vi.hoisted(() => ({ mockSearch: { value: '' } }));

vi.mock('@/lib/hooks/useKeycloak', () => ({
  useKeycloak: () => ({ authenticated: true, initializing: false, token: 'token' }),
}));

vi.mock('@/lib/hooks/useNotificationStore', () => ({
  useNotificationStore: () => ({ addNotification: vi.fn() }),
}));

vi.mock('@/app/[lang]/Providers', async () => {
  const dictionary = (await import('@/dictionaries/en.json')).default;
  return { useDictionary: () => dictionary };
});

vi.mock('next/navigation', async () => {
  const actual = await vi.importActual<unknown>('next/navigation');
  return {
    ...(actual as Record<string, unknown>),
    useRouter: () => ({ push: vi.fn() }),
    usePathname: () => '/en/admin/jobs',
    useSearchParams: () => new URLSearchParams(mockSearch.value),
  };
});

import makeStore from '@/lib/store';
import { setAuthenticated, setToken } from '@/lib/slices/keycloakSlice';
import { JobsPanel } from '@/src/features/admin/ui/JobsPanel';

let store: ReturnType<typeof makeStore>;

const listJobs =
  (items: JobListItem[]): Handler =>
  (url, method) =>
    method === 'GET' && url.pathname.endsWith('/admin/jobs')
      ? {
          status: 200,
          body: {
            items,
            page: { offset: 0, limit: 10, total: items.length },
            filters: {},
            sort: 'createdAt:desc',
          },
        }
      : undefined;

const swrTestConfig = { provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false };

const panel = () => (
  <Provider store={store}>
    <SWRConfig value={swrTestConfig}>
      <JobsPanel />
    </SWRConfig>
  </Provider>
);

const renderPanel = async () => {
  let rendered: ReturnType<typeof render> | undefined;
  await act(async () => {
    rendered = render(panel());
  });
  return rendered!;
};

/** The URL as Next reports it after a change, such as a search's or a link's. */
const arriveAt = async (rendered: ReturnType<typeof render>, search: string) => {
  mockSearch.value = search;
  await act(async () => {
    rendered.rerender(panel());
  });
};

const listRequests = (server: ReturnType<typeof stubJobsServer>) =>
  server.calls('GET', '/admin/jobs').map(([input]) => new URL(String(input), 'http://localhost'));

describe('JobsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearch.value = '';
    store = makeStore();
    store.dispatch(setToken('token'));
    store.dispatch(setAuthenticated(true));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('labels each type in the reader’s language, and the rest by the server’s name', async () => {
    stubJobsServer(
      listJobs([
        jobListItem({ id: '00000000-0000-4000-8000-000000000001', type: 'submission.submitted' }),
        jobListItem({ id: '00000000-0000-4000-8000-000000000002' }),
        jobListItem({ id: '00000000-0000-4000-8000-000000000003', type: 'post-submission-export' }),
      ]),
    );
    await renderPanel();

    // The type filter lists the same names, so these are read from the table.
    const table = within(await screen.findByRole('table'));
    expect(await table.findByText(en.jobs.types.submissionSubmitted)).toBeInTheDocument();
    expect(table.getByText(en.postSubmission.email.label)).toBeInTheDocument();
    expect(await table.findByText('Export submissions')).toHaveAttribute('lang', 'en');
    expect(screen.getByTestId('job-status-00000000-0000-4000-8000-000000000002')).toHaveTextContent(
      en.jobs.statuses.cancelled,
    );
  });

  it('sends the filters the URL holds, and drops any the API would refuse', async () => {
    // The submission id has version 0, which the API's UUID check refuses.
    mockSearch.value = `jobs.status=bogus&jobs.formId=abc&jobs.submissionId=11111111-1111-0111-8111-111111111111&jobs.type=post-submission-log&jobs.workspaceId=${WORKSPACE_ID}`;
    const replaceState = vi.spyOn(window.history, 'replaceState');
    const server = stubJobsServer(listJobs([]));
    await renderPanel();

    await waitFor(() => expect(listRequests(server).length).toBeGreaterThan(0));
    const params = listRequests(server)[0].searchParams;
    expect(params.get('type')).toBe('post-submission-log');
    expect(params.get('workspaceId')).toBe(WORKSPACE_ID);
    expect(params.has('status')).toBe(false);
    expect(params.has('formId')).toBe(false);
    expect(params.has('submissionId')).toBe(false);
    // The URL is rewritten to what was sent.
    const written = String(replaceState.mock.calls.at(-1)?.[2]);
    expect(written).toContain('jobs.type=post-submission-log');
    expect(written).not.toContain('jobs.formId');
    expect(written).not.toContain('jobs.status');
    expect(written).not.toContain('jobs.submissionId');
  });

  it('empties the fields on Reset, with no filters in the URL', async () => {
    stubJobsServer(listJobs([]));
    await renderPanel();

    const workspaceField = screen.getByLabelText(en.admin.jobs.workspaceIdLabel);
    await userEvent.type(workspaceField, 'abc');
    expect(screen.getByTestId('jobs-search')).toBeDisabled();
    await userEvent.click(screen.getByTestId('jobs-clear-filters'));

    expect(workspaceField).toHaveValue('');
    expect(screen.getByTestId('jobs-search')).toBeEnabled();
  });

  it('keeps the fields and focus when the URL catches up with a search', async () => {
    stubJobsServer(listJobs([]));
    const rendered = await renderPanel();

    const workspaceField = screen.getByLabelText(en.admin.jobs.workspaceIdLabel);
    await userEvent.type(workspaceField, WORKSPACE_ID);
    await userEvent.click(screen.getByTestId('jobs-search'));
    const search = screen.getByTestId('jobs-search');
    await arriveAt(rendered, `jobs.workspaceId=${WORKSPACE_ID}`);

    expect(screen.getByTestId('jobs-search')).toBe(search);
    expect(search).toHaveFocus();
    expect(workspaceField).toHaveValue(WORKSPACE_ID);
  });

  it('shows the filters of a URL reached from elsewhere, such as Back', async () => {
    stubJobsServer(listJobs([]));
    const rendered = await renderPanel();

    await userEvent.type(screen.getByLabelText(en.admin.jobs.formIdLabel), 'abc');
    await arriveAt(rendered, `jobs.workspaceId=${WORKSPACE_ID}`);

    expect(screen.getByLabelText(en.admin.jobs.workspaceIdLabel)).toHaveValue(WORKSPACE_ID);
    expect(screen.getByLabelText(en.admin.jobs.formIdLabel)).toHaveValue('');
  });

  it('holds Search off for a partial id, then puts the filters in the URL', async () => {
    const replaceState = vi.spyOn(window.history, 'replaceState');
    stubJobsServer(listJobs([]));
    await renderPanel();

    const workspaceField = screen.getByLabelText(en.admin.jobs.workspaceIdLabel);
    await userEvent.type(workspaceField, 'abc');
    expect(screen.getByTestId('jobs-search')).toBeDisabled();
    expect(screen.getByText(en.admin.jobs.invalidId)).toBeInTheDocument();

    await userEvent.clear(workspaceField);
    await userEvent.type(workspaceField, WORKSPACE_ID);
    await userEvent.click(screen.getByTestId('jobs-search'));

    expect(String(replaceState.mock.calls.at(-1)?.[2])).toContain(
      `jobs.workspaceId=${WORKSPACE_ID}`,
    );
  });
});
