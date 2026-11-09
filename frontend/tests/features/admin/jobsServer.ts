import { vi } from 'vitest';
import type { JobDetail, JobListItem, JobTypeItem } from '@/src/types/admin';
import type { StaffJobDetail, StaffJobListItem } from '@/src/types/jobs';

export const JOB_ID = '01a184ab-c640-72d5-84d5-d2f5551ef5b1';
export const PARENT_ID = '01a184ab-c63a-7118-8dcd-79d2729bc6e3';
export const WORKSPACE_ID = '01a1806a-f064-716a-b1e3-55bd9e1eb395';
export const FORM_ID = '01a1806a-f0a5-71ab-8944-99a1477ae27b';
export const SUBMISSION_ID = '01a184ab-045f-751d-bd8d-afb67bd33f0d';

const AT = '2026-10-28T22:40:12.352Z';

export const jobListItem = (overrides: Partial<JobListItem> = {}): JobListItem => ({
  id: JOB_ID,
  type: 'post-submission-email-addresses',
  status: 'cancelled',
  attempts: 1,
  maxAttempts: 8,
  workspaceId: WORKSPACE_ID,
  workspaceName: 'Licensing',
  formId: FORM_ID,
  formName: 'Permit application',
  submissionId: SUBMISSION_ID,
  createdAt: AT,
  runAfter: AT,
  finishedAt: AT,
  cancelRequestedAt: null,
  requeueCount: 0,
  lastError: 'Notifications are off',
  ...overrides,
});

export const jobDetail = (overrides: Partial<JobDetail> = {}): JobDetail => ({
  ...jobListItem(),
  revisionId: '01a184ab-c5d3-77ec-b373-c9ce391c5f13',
  startedAt: AT,
  createdBy: { id: '01a1806a-b238-71d9-9134-7443c22a547c', displayLabel: 'J2SHERMA' },
  lastRequeuedAt: null,
  lastRequeuedBy: null,
  cancelRequestedBy: null,
  optionNames: ['to'],
  recordedActions: [],
  parentJobId: PARENT_ID,
  childrenQueuedAt: null,
  parent: {
    id: PARENT_ID,
    type: 'submission.submitted',
    status: 'succeeded',
    createdAt: AT,
    finishedAt: AT,
  },
  children: [],
  emailCounts: { addresses: 3, sent: 1, refused: 1, pending: 1 },
  ...overrides,
});

/** A job as a form's or a workspace's list returns it: names and the confirmation ID, no ids. */
export const staffJobListItem = (overrides: Partial<StaffJobListItem> = {}): StaffJobListItem => ({
  id: JOB_ID,
  type: 'post-submission-email-addresses',
  status: 'cancelled',
  attempts: 1,
  maxAttempts: 8,
  formName: 'Permit application',
  confirmationCode: 'AH2N6XHC',
  submissionId: SUBMISSION_ID,
  createdAt: AT,
  runAfter: AT,
  finishedAt: AT,
  cancelRequestedAt: null,
  requeueCount: 0,
  lastError: 'Notifications are off',
  ...overrides,
});

export const staffJobDetail = (overrides: Partial<StaffJobDetail> = {}): StaffJobDetail => ({
  ...staffJobListItem(),
  startedAt: AT,
  createdBy: { displayLabel: 'Submitter' },
  lastRequeuedAt: null,
  lastRequeuedBy: null,
  cancelRequestedBy: null,
  recordedActions: [],
  parentJobId: PARENT_ID,
  childrenQueuedAt: null,
  parent: {
    id: PARENT_ID,
    type: 'submission.submitted',
    status: 'succeeded',
    createdAt: AT,
    finishedAt: AT,
  },
  children: [],
  emailCounts: { addresses: 3, sent: 1, refused: 1, pending: 1 },
  ...overrides,
});

export const JOB_TYPES: JobTypeItem[] = [
  { type: 'submission.submitted', name: 'Submission received' },
  { type: 'post-submission-email-addresses', name: 'Email a list of addresses' },
  { type: 'post-submission-export', name: 'Export submissions' },
];

export type Reply = { status: number; body: unknown };
export type Handler = (url: URL, method: string) => Reply | undefined;

const toResponse = ({ status, body }: Reply): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: () => Promise.resolve(body),
  }) as unknown as Response;

/**
 * Stands in for the backend at the network boundary: the API module, hooks and SWR run as shipped.
 * Each request goes to the first handler that answers it; anything else is a 404.
 */
export function stubJobsServer(...handlers: Handler[]) {
  const answer = (url: URL, method: string): Reply => {
    if (method === 'GET' && url.pathname.endsWith('/admin/jobs/types')) {
      return { status: 200, body: { items: JOB_TYPES } };
    }
    for (const handler of handlers) {
      const reply = handler(url, method);
      if (reply) return reply;
    }
    return { status: 404, body: { error: 'Not found' } };
  };
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    return Promise.resolve(toResponse(answer(url, init?.method ?? 'GET')));
  });
  vi.stubGlobal('fetch', fetchMock);
  const calls = (method: string, path: string) =>
    fetchMock.mock.calls.filter(
      ([input, init]) =>
        (init?.method ?? 'GET') === method &&
        new URL(String(input), 'http://localhost').pathname.endsWith(path),
    );
  return { fetchMock, calls };
}
