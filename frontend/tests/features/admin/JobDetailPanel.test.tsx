import React, { act } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { SWRConfig } from 'swr';
import en from '@/dictionaries/en.json';
import type { JobDetail } from '@/src/types/admin';
import { JOB_ID, PARENT_ID, jobDetail, stubJobsServer, type Handler } from './jobsServer';

const { mockAddNotification, mockUseCurrentUser } = vi.hoisted(() => ({
  mockAddNotification: vi.fn(),
  mockUseCurrentUser: vi.fn(),
}));

vi.mock('@/lib/hooks/useKeycloak', () => ({
  useKeycloak: () => ({ authenticated: true, initializing: false, token: 'token' }),
}));

vi.mock('@/src/shared/api/useCurrentUser', () => ({
  useCurrentUser: () => mockUseCurrentUser(),
}));

vi.mock('@/lib/hooks/useNotificationStore', () => ({
  useNotificationStore: () => ({ addNotification: mockAddNotification }),
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
    usePathname: () => `/en/admin/jobs/${JOB_ID}`,
    useSearchParams: () => new URLSearchParams(''),
  };
});

import makeStore from '@/lib/store';
import { setAuthenticated, setToken } from '@/lib/slices/keycloakSlice';
import { JobDetailPanel } from '@/src/features/admin/ui/JobDetailPanel';

const dictDetail = en.jobs.detail;
let store: ReturnType<typeof makeStore>;

/** The job the server holds, read and changed by the handlers below. */
let current: JobDetail;

const readJob: Handler = (url, method) =>
  method === 'GET' && url.pathname.endsWith(`/admin/jobs/${JOB_ID}`)
    ? { status: 200, body: current }
    : undefined;

const on =
  (action: 'rerun' | 'cancel', reply: () => { status: number; body: unknown }): Handler =>
  (url, method) =>
    method === 'POST' && url.pathname.endsWith(`/admin/jobs/${JOB_ID}/${action}`)
      ? reply()
      : undefined;

const renderPanel = async (jobId = JOB_ID) => {
  await act(async () => {
    render(
      <Provider store={store}>
        <SWRConfig
          value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}
        >
          <JobDetailPanel jobId={jobId} />
        </SWRConfig>
      </Provider>,
    );
  });
};

const confirm = async () => {
  await userEvent.click(await screen.findByTestId('confirm-modal-confirm'));
};

describe('JobDetailPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store = makeStore();
    store.dispatch(setToken('token'));
    store.dispatch(setAuthenticated(true));
    mockUseCurrentUser.mockReturnValue({
      data: { capabilities: { isSobaAdmin: true } },
      loaded: true,
    });
    current = jobDetail();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('shows the facts, the email counts and Run again for a cancelled job', async () => {
    stubJobsServer(readJob);
    await renderPanel();

    expect(await screen.findByTestId('job-fact-type')).toHaveTextContent(
      en.postSubmission.email.label,
    );
    expect(screen.getByTestId('job-fact-attempts')).toHaveTextContent('1 of 8');
    expect(screen.getByTestId('job-fact-options')).toHaveTextContent('to');
    expect(screen.getByTestId('job-fact-last-error')).toHaveTextContent('Notifications are off');
    expect(screen.getByTestId('job-fact-emails-sent')).toHaveTextContent('1');
    expect(screen.getByTestId('job-fact-emails-refused')).toHaveTextContent('1');
    expect(screen.getByTestId('job-fact-emails-pending')).toHaveTextContent('1');
    expect(screen.getByTestId(`job-related-${PARENT_ID}`)).toHaveAttribute(
      'href',
      `/en/admin/jobs/${PARENT_ID}`,
    );
    expect(screen.getByTestId(`job-related-${PARENT_ID}`)).toHaveTextContent(
      en.jobs.types.submissionSubmitted,
    );
    expect(screen.getByTestId('job-form-jobs').getAttribute('href')).toContain('jobs.formId=');
    expect(screen.getByTestId('job-rerun')).toBeInTheDocument();
    expect(screen.queryByTestId('job-stop')).not.toBeInTheDocument();
  });

  it("shows an export's progress and the file it produced, with no way to download it", async () => {
    current = jobDetail({
      type: 'submission-export',
      status: 'succeeded',
      lastError: null,
      emailCounts: undefined,
      progress: { done: 40, total: 40 },
      result: {
        state: 'ready',
        filename: 'Permit 2026-10-29.csv',
        size: 2100,
        contentType: 'text/csv',
        expiresAt: '2026-11-05T19:00:00.000Z',
      },
    });
    stubJobsServer(readJob);
    await renderPanel();

    expect(await screen.findByTestId('job-fact-type')).toHaveTextContent(
      en.jobs.types.submissionExport,
    );
    expect(screen.getByTestId('job-fact-progress')).toHaveTextContent('40 of 40');
    expect(screen.getByTestId('job-fact-result')).toHaveTextContent(
      'Permit 2026-10-29.csv, 2.1 kB',
    );
    expect(screen.getByTestId('job-fact-result')).toHaveTextContent('kept until');
    expect(screen.queryByRole('link', { name: /Permit 2026-10-29/ })).not.toBeInTheDocument();
  });

  it.each(['cancelled', 'dead'] as const)(
    'offers no Run again for a %s export, and says how to export again',
    async (status) => {
      current = jobDetail({ type: 'submission-export', status, emailCounts: undefined });
      stubJobsServer(readJob);
      await renderPanel();

      expect(await screen.findByTestId('job-export-ended')).toHaveTextContent(
        en.jobs.detail.exportEnded,
      );
      expect(screen.queryByTestId('job-rerun')).not.toBeInTheDocument();
    },
  );

  it('says when the file a job produced expired', async () => {
    current = jobDetail({
      type: 'submission-export',
      status: 'succeeded',
      lastError: null,
      emailCounts: undefined,
      result: { state: 'expired', expiresAt: '2026-11-05T19:00:00.000Z' },
    });
    stubJobsServer(readJob);
    await renderPanel();

    expect(await screen.findByTestId('job-fact-result')).toHaveTextContent('Expired on');
    expect(screen.queryByTestId('job-fact-progress')).not.toBeInTheDocument();
  });

  it('runs the job again after confirming, then offers Stop job', async () => {
    const server = stubJobsServer(
      readJob,
      on('rerun', () => {
        current = jobDetail({ status: 'queued', attempts: 0, finishedAt: null, requeueCount: 1 });
        return { status: 200, body: current };
      }),
    );
    await renderPanel();

    await userEvent.click(await screen.findByTestId('job-rerun'));
    // The refused address is tried again along with the one not sent yet.
    expect(screen.getByTestId('confirm-modal-message')).toHaveTextContent(
      'Addresses it will try: 2.',
    );
    await confirm();

    await waitFor(() =>
      expect(mockAddNotification).toHaveBeenCalledWith({
        text: dictDetail.rerunSuccess,
        type: 'success',
      }),
    );
    expect(server.calls('POST', `/admin/jobs/${JOB_ID}/rerun`)).toHaveLength(1);
    expect(await screen.findByTestId('job-stop')).toBeInTheDocument();
    expect(screen.queryByTestId('job-rerun')).not.toBeInTheDocument();
    expect(screen.getByTestId('job-status')).toHaveTextContent(en.jobs.statuses.queued);
    expect(screen.getByTestId('job-status-line')).toHaveFocus();
  });

  it("shows the server's reason for refusing and reads the job again", async () => {
    const server = stubJobsServer(
      readJob,
      on('rerun', () => {
        // Another administrator ran it again first.
        current = jobDetail({ status: 'queued', finishedAt: null });
        return {
          status: 409,
          body: { error: 'Its last run may still be finishing; try again in a minute' },
        };
      }),
    );
    await renderPanel();

    await userEvent.click(await screen.findByTestId('job-rerun'));
    await confirm();

    await waitFor(() =>
      expect(mockAddNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'The job was not changed: Its last run may still be finishing; try again in a minute',
          type: 'error',
        }),
      ),
    );
    await waitFor(() => expect(server.calls('GET', `/admin/jobs/${JOB_ID}`)).toHaveLength(2));
    // The re-read took away the button that opened the dialog.
    await waitFor(() => expect(screen.queryByTestId('job-rerun')).not.toBeInTheDocument());
    expect(screen.getByTestId('job-status-line')).toHaveFocus();
  });

  it('offers no Run again for a submission-received job that queued its actions', async () => {
    current = jobDetail({
      type: 'submission.submitted',
      status: 'dead',
      parentJobId: null,
      parent: undefined,
      emailCounts: undefined,
      childrenQueuedAt: '2026-09-01T00:00:00.000Z',
    });
    stubJobsServer(readJob);
    await renderPanel();

    expect(await screen.findByTestId('job-actions-queued')).toHaveTextContent(
      dictDetail.actionsQueued,
    );
    expect(screen.queryByTestId('job-rerun')).not.toBeInTheDocument();
  });

  it('asks a running job to stop and says the stop is pending', async () => {
    current = jobDetail({ status: 'running', finishedAt: null, lastError: null });
    stubJobsServer(
      readJob,
      on('cancel', () => {
        current = { ...current, cancelRequestedAt: '2026-10-28T22:41:00.000Z' };
        return { status: 202, body: current };
      }),
    );
    await renderPanel();

    expect(screen.queryByTestId('job-rerun')).not.toBeInTheDocument();
    await userEvent.click(await screen.findByTestId('job-stop'));
    expect(screen.getByTestId('confirm-modal-confirm')).toHaveTextContent(dictDetail.stop);
    await confirm();

    await waitFor(() =>
      expect(mockAddNotification).toHaveBeenCalledWith({
        text: dictDetail.stopRequested,
        type: 'success',
      }),
    );
    expect(await screen.findByText(dictDetail.stopPending)).toBeInTheDocument();
    expect(screen.queryByTestId('job-stop')).not.toBeInTheDocument();
  });

  it('reads a running job again every few seconds until it ends', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    current = jobDetail({ status: 'running', finishedAt: null });
    const server = stubJobsServer(readJob);
    await renderPanel();
    await screen.findByTestId('job-stop');

    current = jobDetail({ status: 'succeeded', lastError: null, emailCounts: undefined });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(await screen.findByTestId('job-status')).toHaveTextContent(en.jobs.statuses.succeeded);
    const reads = server.calls('GET', `/admin/jobs/${JOB_ID}`).length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(server.calls('GET', `/admin/jobs/${JOB_ID}`)).toHaveLength(reads);
  });

  it('keeps following a job through a failed read, and says so meanwhile', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    current = jobDetail({ status: 'running', finishedAt: null });
    let failNext = false;
    const flaky: Handler = (url, method) => {
      if (!failNext || method !== 'GET' || !url.pathname.endsWith(`/admin/jobs/${JOB_ID}`)) {
        return undefined;
      }
      failNext = false;
      return { status: 502, body: { error: 'Bad gateway' } };
    };
    stubJobsServer(flaky, readJob);
    await renderPanel();
    await screen.findByTestId('job-stop');

    failNext = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(await screen.findByTestId('job-refresh-error')).toHaveTextContent(
      dictDetail.refreshError,
    );

    current = jobDetail({ status: 'succeeded', lastError: null });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(await screen.findByTestId('job-status')).toHaveTextContent(en.jobs.statuses.succeeded);
    expect(screen.queryByTestId('job-refresh-error')).not.toBeInTheDocument();
  });

  it('follows a job it ran again until it ends', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubJobsServer(
      readJob,
      on('rerun', () => {
        current = jobDetail({ status: 'queued', attempts: 0, finishedAt: null, requeueCount: 1 });
        return { status: 200, body: current };
      }),
    );
    await renderPanel();
    await userEvent.click(await screen.findByTestId('job-rerun'));
    await confirm();
    await screen.findByTestId('job-stop');

    current = jobDetail({ status: 'succeeded', lastError: null, requeueCount: 1 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(await screen.findByTestId('job-status')).toHaveTextContent(en.jobs.statuses.succeeded);
  });

  it('says a parent that was deleted is no longer kept', async () => {
    current = jobDetail({ parent: undefined });
    stubJobsServer(readJob);
    await renderPanel();

    expect(await screen.findByTestId('job-fact-parent')).toHaveTextContent(dictDetail.parentGone);
  });

  it('explains retention for a job the server does not have', async () => {
    stubJobsServer();
    await renderPanel();

    expect(await screen.findByTestId('job-load-error')).toHaveTextContent(dictDetail.notFound);
  });

  it('does not ask for an id that is not one', async () => {
    const server = stubJobsServer();
    await renderPanel('not-a-job');

    expect(await screen.findByTestId('job-load-error')).toHaveTextContent(dictDetail.notFound);
    expect(server.calls('GET', '/admin/jobs/not-a-job')).toHaveLength(0);
  });

  it('refuses a signed-in non-admin before reading anything', async () => {
    mockUseCurrentUser.mockReturnValue({
      data: { capabilities: { isSobaAdmin: false } },
      loaded: true,
    });
    const server = stubJobsServer(readJob);
    await renderPanel();

    expect(screen.getByText(en.admin.forbidden)).toBeInTheDocument();
    expect(server.fetchMock).not.toHaveBeenCalled();
  });
});
