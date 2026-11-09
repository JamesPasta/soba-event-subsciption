import React, { act } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { SWRConfig } from 'swr';
import en from '@/dictionaries/en.json';
import type { JobScopeRef, StaffJobListItem } from '@/src/types/jobs';
import {
  FORM_ID,
  JOB_ID,
  staffJobListItem,
  stubJobsServer,
  type Handler,
} from '../admin/jobsServer';

const { mockSearch, mockPush } = vi.hoisted(() => ({
  mockSearch: { value: '' },
  mockPush: vi.fn(),
}));

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
    useRouter: () => ({ push: mockPush }),
    usePathname: () => '/en/build/f1',
    useSearchParams: () => new URLSearchParams(mockSearch.value),
  };
});

import makeStore from '@/lib/store';
import { setAuthenticated, setToken } from '@/lib/slices/keycloakSlice';
import { ScopedJobsPanel } from '@/src/features/jobs/ui/ScopedJobsPanel';

const WORKSPACE = 'w1';
const FORM_SCOPE: JobScopeRef = { kind: 'form', formId: 'f1' };
const WORKSPACE_SCOPE: JobScopeRef = { kind: 'workspace', workspaceId: WORKSPACE };

let store: ReturnType<typeof makeStore>;

const listJobs =
  (path: string, items: StaffJobListItem[]): Handler =>
  (url, method) =>
    method === 'GET' && url.pathname.endsWith(path)
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

const jobForms: Handler = (url, method) =>
  method === 'GET' && url.pathname.endsWith(`/workspaces/${WORKSPACE}/jobs/forms`)
    ? { status: 200, body: { items: [{ id: FORM_ID, name: 'Permit application' }] } }
    : undefined;

const jobHref = (id: string) => `/en/jobs-page/${id}`;

const renderPanel = async (scope: JobScopeRef) => {
  await act(async () => {
    render(
      <Provider store={store}>
        <SWRConfig
          value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}
        >
          <ScopedJobsPanel scope={scope} jobHref={jobHref} />
        </SWRConfig>
      </Provider>,
    );
  });
};

const requests = (server: ReturnType<typeof stubJobsServer>, path: string) =>
  server.calls('GET', path).map(([input]) => new URL(String(input), 'http://localhost'));

describe('ScopedJobsPanel', () => {
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

  it("lists a form's jobs by confirmation ID, without a form column", async () => {
    const server = stubJobsServer(listJobs('/design/forms/f1/jobs', [staffJobListItem()]));
    await renderPanel(FORM_SCOPE);

    const table = within(await screen.findByRole('table'));
    expect(await table.findByText('AH2N6XHC')).toBeInTheDocument();
    expect(table.getByText(en.postSubmission.email.label)).toBeInTheDocument();
    expect(table.queryByText(en.jobs.columns.form)).not.toBeInTheDocument();
    expect(screen.getByText(en.jobs.formIntro)).toBeInTheDocument();
    expect(screen.queryByTestId('jobs-form-filter')).not.toBeInTheDocument();
    expect(requests(server, '/design/forms/f1/jobs')[0].searchParams.get('sort')).toBe(
      'createdAt:desc',
    );
  });

  it('sends the filters the URL holds, and never a form for a form', async () => {
    mockSearch.value = `formJobs.status=dead&formJobs.type=submission.submitted&formJobs.formId=${FORM_ID}`;
    const server = stubJobsServer(listJobs('/design/forms/f1/jobs', []));
    await renderPanel(FORM_SCOPE);

    const sent = requests(server, '/design/forms/f1/jobs').at(-1)!.searchParams;
    expect(sent.get('status')).toBe('dead');
    expect(sent.get('type')).toBe('submission.submitted');
    expect(sent.has('formId')).toBe(false);
  });

  it("lists a workspace's jobs with their forms, and narrows to the form chosen", async () => {
    mockSearch.value = `workspaceJobs.formId=${FORM_ID}`;
    const server = stubJobsServer(
      jobForms,
      listJobs(`/workspaces/${WORKSPACE}/jobs`, [staffJobListItem()]),
    );
    await renderPanel(WORKSPACE_SCOPE);

    const table = within(await screen.findByRole('table'));
    expect(await table.findByText('Permit application')).toBeInTheDocument();
    expect(screen.getByText(en.jobs.workspaceIntro)).toBeInTheDocument();
    expect(screen.getByTestId('jobs-form-filter')).toHaveTextContent('Permit application');
    expect(
      requests(server, `/workspaces/${WORKSPACE}/jobs`).at(-1)!.searchParams.get('formId'),
    ).toBe(FORM_ID);
  });

  // A remembered form whose jobs have since been deleted, or a hand-edited type.
  it('drops a type or a form the fields do not offer, so the URL and the fields agree', async () => {
    const OTHER_FORM = '01a1806a-f0a5-71ab-8944-99a1477ae999';
    mockSearch.value = `workspaceJobs.type=post-submission-export&workspaceJobs.formId=${OTHER_FORM}`;
    const replaceState = vi.spyOn(window.history, 'replaceState');
    const server = stubJobsServer(jobForms, listJobs(`/workspaces/${WORKSPACE}/jobs`, []));
    await renderPanel(WORKSPACE_SCOPE);

    await waitFor(() => expect(replaceState).toHaveBeenCalled());
    const url = String(replaceState.mock.calls.at(-1)![2]);
    expect(url).not.toContain('workspaceJobs.type');
    expect(url).not.toContain('workspaceJobs.formId');
    const sent = requests(server, `/workspaces/${WORKSPACE}/jobs`).at(-1)!.searchParams;
    expect(sent.has('type')).toBe(false);
    expect(sent.has('formId')).toBe(false);
  });

  it("opens a job's page from its row", async () => {
    stubJobsServer(listJobs('/design/forms/f1/jobs', [staffJobListItem()]));
    await renderPanel(FORM_SCOPE);

    await userEvent.click(await screen.findByTestId(`job-link-${JOB_ID}`));
    expect(mockPush).toHaveBeenCalledWith(jobHref(JOB_ID));
  });
});
