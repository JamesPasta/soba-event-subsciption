import React, { act } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { SWRConfig } from 'swr';
import en from '@/dictionaries/en.json';
import type { JobScopeRef, StaffJobDetail } from '@/src/types/jobs';
import {
  JOB_ID,
  PARENT_ID,
  SUBMISSION_ID,
  staffJobDetail,
  stubJobsServer,
  type Handler,
} from '../admin/jobsServer';

const { mockAddNotification } = vi.hoisted(() => ({ mockAddNotification: vi.fn() }));

vi.mock('@/lib/hooks/useKeycloak', () => ({
  useKeycloak: () => ({ authenticated: true, initializing: false, token: 'token' }),
}));

vi.mock('@/lib/hooks/useNotificationStore', () => ({
  useNotificationStore: () => ({ addNotification: mockAddNotification }),
}));

vi.mock('@/app/[lang]/Providers', async () => {
  const dictionary = (await import('@/dictionaries/en.json')).default;
  return { useDictionary: () => dictionary };
});

import makeStore from '@/lib/store';
import { setAuthenticated, setToken } from '@/lib/slices/keycloakSlice';
import { ScopedJobDetailPanel } from '@/src/features/jobs/ui/ScopedJobDetailPanel';

const AT = '2026-10-28T22:40:12.352Z';
const FORM_SCOPE: JobScopeRef = { kind: 'form', formId: 'f1' };
const WORKSPACE_SCOPE: JobScopeRef = { kind: 'workspace', workspaceId: 'w1' };
const FORM_JOB = `/design/forms/f1/jobs/${JOB_ID}`;
const WORKSPACE_JOB = `/workspaces/w1/jobs/${JOB_ID}`;
const BACK = '/en/build/f1?tab=jobs&from=nav';

let store: ReturnType<typeof makeStore>;

/** The job the server holds, read and changed by the handlers below. */
let current: StaffJobDetail;

const readJob =
  (path: string): Handler =>
  (url, method) =>
    method === 'GET' && url.pathname.endsWith(path) ? { status: 200, body: current } : undefined;

const on =
  (path: string, reply: () => { status: number; body: unknown }): Handler =>
  (url, method) =>
    method === 'POST' && url.pathname.endsWith(path) ? reply() : undefined;

const renderPanel = async (
  scope: JobScopeRef,
  submissionHref?: (id: string) => string,
  jobId = JOB_ID,
) => {
  await act(async () => {
    render(
      <Provider store={store}>
        <SWRConfig
          value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}
        >
          <ScopedJobDetailPanel
            scope={scope}
            jobId={jobId}
            backHref={BACK}
            jobHref={(id) => `/en/job-page/${id}`}
            submissionHref={submissionHref}
          />
        </SWRConfig>
      </Provider>,
    );
  });
};

describe('ScopedJobDetailPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store = makeStore();
    store.dispatch(setToken('token'));
    store.dispatch(setAuthenticated(true));
    current = staffJobDetail();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the facts a form administrator may see, and links the submission', async () => {
    stubJobsServer(readJob(FORM_JOB));
    await renderPanel(FORM_SCOPE, (id) => `/en/build/f1/submissions/${id}`);

    expect(await screen.findByTestId('job-fact-type')).toHaveTextContent(
      en.postSubmission.email.label,
    );
    expect(screen.getByTestId('job-submission-link')).toHaveAttribute(
      'href',
      `/en/build/f1/submissions/${SUBMISSION_ID}`,
    );
    expect(screen.getByTestId('job-submission-link')).toHaveTextContent('AH2N6XHC');
    expect(screen.getByTestId('job-fact-created')).toHaveTextContent('Submitter');
    expect(screen.getByTestId(`job-related-${PARENT_ID}`)).toHaveAttribute(
      'href',
      `/en/job-page/${PARENT_ID}`,
    );
    expect(screen.getByTestId('job-fact-emails-refused')).toHaveTextContent('1');
    expect(screen.getByTestId('job-back')).toHaveAttribute('href', BACK);
    // No workspace, revision or options: those are the administration page's.
    for (const fact of ['workspace', 'revision', 'options', 'form']) {
      expect(screen.queryByTestId(`job-fact-${fact}`)).not.toBeInTheDocument();
    }
  });

  it('names a member of the workspace, and says where anyone else stands', async () => {
    current = staffJobDetail({
      status: 'running',
      requeueCount: 1,
      lastRequeuedAt: AT,
      lastRequeuedBy: { standing: 'member', displayLabel: 'Form Admin' },
      cancelRequestedAt: AT,
      cancelRequestedBy: { standing: 'platformAdministrator', displayLabel: null },
    });
    stubJobsServer(readJob(FORM_JOB));
    await renderPanel(FORM_SCOPE);

    expect(await screen.findByTestId('job-fact-reruns')).toHaveTextContent('Form Admin');
    expect(screen.getByTestId('job-fact-stop-requested')).toHaveTextContent(
      en.jobs.platformAdministrator,
    );
  });

  it('calls someone who has left the workspace a former member', async () => {
    current = staffJobDetail({
      requeueCount: 1,
      lastRequeuedAt: AT,
      lastRequeuedBy: { standing: 'formerMember', displayLabel: null },
    });
    stubJobsServer(readJob(FORM_JOB));
    await renderPanel(FORM_SCOPE);

    expect(await screen.findByTestId('job-fact-reruns')).toHaveTextContent(en.jobs.formerMember);
  });

  it("runs the job again through the form's route, then offers Stop job", async () => {
    const server = stubJobsServer(
      readJob(FORM_JOB),
      on(`${FORM_JOB}/rerun`, () => {
        current = staffJobDetail({ status: 'queued', finishedAt: null, requeueCount: 1 });
        return { status: 200, body: current };
      }),
    );
    await renderPanel(FORM_SCOPE);

    await userEvent.click(await screen.findByTestId('job-rerun'));
    expect(screen.getByTestId('confirm-modal-message')).toHaveTextContent(
      'changes to its list since then do not reach it',
    );
    await userEvent.click(await screen.findByTestId('confirm-modal-confirm'));

    await waitFor(() =>
      expect(mockAddNotification).toHaveBeenCalledWith({
        text: en.jobs.detail.rerunSuccess,
        type: 'success',
      }),
    );
    expect(server.calls('POST', `${FORM_JOB}/rerun`)).toHaveLength(1);
    expect(await screen.findByTestId('job-stop')).toBeInTheDocument();
    expect(screen.getByTestId('job-status-line')).toHaveFocus();
  });

  it("stops a workspace's job through the workspace's route, and shows its form", async () => {
    current = staffJobDetail({ status: 'queued', finishedAt: null });
    const server = stubJobsServer(
      readJob(WORKSPACE_JOB),
      on(`${WORKSPACE_JOB}/cancel`, () => {
        current = staffJobDetail({
          status: 'cancelled',
          cancelRequestedAt: AT,
          cancelRequestedBy: { standing: 'member', displayLabel: 'Owner' },
        });
        return { status: 200, body: current };
      }),
    );
    await renderPanel(WORKSPACE_SCOPE);

    expect(await screen.findByTestId('job-fact-form')).toHaveTextContent('Permit application');
    // The owner's form permissions are not known here, so the submission is not linked.
    expect(screen.queryByTestId('job-submission-link')).not.toBeInTheDocument();
    expect(screen.getByTestId('job-fact-submission')).toHaveTextContent('AH2N6XHC');

    await userEvent.click(screen.getByTestId('job-stop'));
    await userEvent.click(await screen.findByTestId('confirm-modal-confirm'));

    await waitFor(() => expect(server.calls('POST', `${WORKSPACE_JOB}/cancel`)).toHaveLength(1));
    expect(await screen.findByTestId('job-fact-stop-requested')).toHaveTextContent('Owner');
  });

  it('says the reader has no access when the server refuses', async () => {
    stubJobsServer((url, method) =>
      method === 'GET' && url.pathname.endsWith(FORM_JOB)
        ? { status: 403, body: { error: 'Forbidden' } }
        : undefined,
    );
    await renderPanel(FORM_SCOPE);

    expect(await screen.findByTestId('job-noaccess')).toHaveTextContent(en.general.noAccess);
  });

  // The stub answers 404 to anything it has no handler for.
  it('says a job the server no longer has was not found, as information', async () => {
    const server = stubJobsServer();
    await renderPanel(FORM_SCOPE);

    expect(await screen.findByTestId('job-not-found')).toHaveTextContent(en.jobs.detail.notFound);
    expect(server.calls('GET', FORM_JOB)).toHaveLength(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('reads nothing for an id that is not one', async () => {
    const server = stubJobsServer();
    await renderPanel(FORM_SCOPE, undefined, 'not-a-job');

    expect(await screen.findByTestId('job-not-found')).toHaveTextContent(en.jobs.detail.notFound);
    expect(server.fetchMock).not.toHaveBeenCalled();
  });

  it('says a failed read failed', async () => {
    stubJobsServer((url, method) =>
      method === 'GET' && url.pathname.endsWith(FORM_JOB)
        ? { status: 500, body: { error: 'Boom' } }
        : undefined,
    );
    await renderPanel(FORM_SCOPE);

    expect(await screen.findByTestId('job-load-error')).toHaveTextContent(en.jobs.detail.loadError);
  });
});
