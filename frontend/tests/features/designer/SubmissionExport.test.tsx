import React, { act } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { SWRConfig } from 'swr';

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }));

vi.mock('@/app/[lang]/Providers', async () => {
  const dict = { ...(await import('@/dictionaries/en.json')).default, locale: 'en' };
  return { useDictionary: () => dict };
});

vi.mock('next/navigation', () => ({
  usePathname: () => '/en/build/f1/submissions/exports',
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

const getSobaForm = vi.fn();
const lookupFormVersions = vi.fn();
const getSobaExportFields = vi.fn();
const listSobaSubmissionExports = vi.fn();
const startSobaSubmissionExport = vi.fn();
const stopSobaSubmissionExport = vi.fn();

vi.mock('@/src/shared/api/sobaApi', () => ({
  getSobaForm: (...args: unknown[]) => getSobaForm(...args),
  lookupFormVersions: (...args: unknown[]) => lookupFormVersions(...args),
  getSobaExportFields: (...args: unknown[]) => getSobaExportFields(...args),
  listSobaSubmissionExports: (...args: unknown[]) => listSobaSubmissionExports(...args),
  startSobaSubmissionExport: (...args: unknown[]) => startSobaSubmissionExport(...args),
  stopSobaSubmissionExport: (...args: unknown[]) => stopSobaSubmissionExport(...args),
}));

import makeStore from '@/lib/store';
import { setAuthenticated, setToken } from '@/lib/slices/keycloakSlice';
import { ApiError } from '@/src/shared/api/sobaHelpers';
import { PageLayout } from '@/src/components/PageLayout';
import { SubmissionExport } from '@/src/features/designer/ui/SubmissionExport';
import type { SubmissionExport as SubmissionExportRecord } from '@/src/types/submissionExport';

const FIELDS = ['form.confirmationId', 'applicantName', 'applicantEmail'];
const FIRST_LAYOUT = 'multiRowEmptySpacesCSVExport';

const QUEUED: SubmissionExportRecord = {
  id: 'e1',
  formId: 'f1',
  formVersionId: 'v2',
  format: 'csv',
  layout: FIRST_LAYOUT,
  status: 'queued',
  createdAt: '2026-10-20T17:12:44.000Z',
  finishedAt: null,
  cancelRequestedAt: null,
};

/** One page of the list as the server answers it. */
const listPage = (items: SubmissionExportRecord[], total = items.length) => ({
  items,
  page: { offset: 0, limit: 10, total },
  sort: 'createdAt:desc',
});

let store: ReturnType<typeof makeStore>;

const notifications = () =>
  store.getState().notification.notifications.map((notification) => notification.text);

async function renderExport() {
  store = makeStore();
  store.dispatch(setToken('token'));
  store.dispatch(setAuthenticated(true));
  await act(async () => {
    render(
      <Provider store={store}>
        <SWRConfig
          value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}
        >
          <PageLayout headingId="submission-export-heading" heading="Export submissions">
            <SubmissionExport formId="f1" />
          </PageLayout>
        </SWRConfig>
      </Provider>,
    );
  });
}

async function openExport() {
  await renderExport();
  await screen.findByTestId('export-form');
  await screen.findByTestId('export-fields');
}

const radio = (name: string) => screen.getByRole('radio', { name }) as HTMLInputElement;
const exportButton = () => screen.getByTestId('export-submit') as HTMLButtonElement;
const lastFieldsFilters = () => getSobaExportFields.mock.calls.at(-1)?.[2];
const startBody = () => startSobaSubmissionExport.mock.calls.at(-1)?.[2];

const click = async (element: Element) => {
  await act(async () => {
    fireEvent.click(element);
  });
};

/** Types a date into a picker's segments, in the order the picker shows them. */
async function typeDate(testId: string, parts: { year: string; month: string; day: string }) {
  const user = userEvent.setup();
  for (const segment of within(screen.getByTestId(testId)).getAllByRole('spinbutton')) {
    const label = segment.getAttribute('aria-label')?.toLowerCase() ?? '';
    const key = (['year', 'month', 'day'] as const).find((name) => label.includes(name));
    if (!key) continue;
    await user.click(segment);
    await user.keyboard(parts[key]);
  }
}

const segmentValues = (testId: string) =>
  within(screen.getByTestId(testId))
    .getAllByRole('spinbutton')
    .map((segment) => segment.getAttribute('aria-valuenow'));

async function chooseRange() {
  await click(radio('Date range'));
  await typeDate('export-from', { year: '2025', month: '10', day: '01' });
  await typeDate('export-to', { year: '2025', month: '10', day: '05' });
}

// To is inclusive on screen, so the upper bound is the start of the next day.
const RANGE = {
  from: new Date('2025-10-01T00:00:00').toISOString(),
  to: new Date('2025-10-06T00:00:00').toISOString(),
};

describe('SubmissionExport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSobaForm.mockResolvedValue({ id: 'f1', name: 'Housing Needs (sample)' });
    lookupFormVersions.mockResolvedValue({
      items: [
        { id: 'v1', versionNo: 1, state: 'archived' },
        { id: 'v2', versionNo: 2, state: 'published' },
      ],
    });
    getSobaExportFields.mockResolvedValue({ fields: FIELDS, count: 12 });
    listSobaSubmissionExports.mockResolvedValue(listPage([]));
    startSobaSubmissionExport.mockResolvedValue(QUEUED);
  });

  it('starts as CSV, all versions and all dates, and says the CSV formats are not applied', async () => {
    await openExport();

    expect(radio('CSV').checked).toBe(true);
    expect(radio('All').checked).toBe(true);
    expect(screen.getByTestId('export-version')).toHaveTextContent('All versions');
    expect(screen.queryByTestId('export-range')).toBeNull();
    expect(lastFieldsFilters()).toEqual({ layout: FIRST_LAYOUT });
    expect(screen.getByTestId('page-notice-submission-export-sample')).toHaveTextContent(
      'The CSV formats are not applied yet.',
    );
  });

  it.each([
    [12, '12 submissions match these filters.'],
    [1, '1 submission matches these filters.'],
    [0, 'No submissions match these filters.'],
  ])('says how many submissions the filters cover (%i)', async (count, said) => {
    getSobaExportFields.mockResolvedValue({ fields: FIELDS, count });
    await openExport();

    expect(screen.getByTestId('export-submission-count')).toHaveTextContent(said);
  });

  it('shows the count for JSON too, and none while the field list reloads', async () => {
    await openExport();
    await click(radio('JSON'));
    expect(await screen.findByTestId('export-submission-count')).toBeInTheDocument();
    await click(radio('CSV'));
    getSobaExportFields.mockReturnValue(new Promise(() => {}));

    await click(radio('2 - Multiple rows per submission'));

    expect(screen.queryByTestId('export-submission-count')).toBeNull();
  });

  it('hides the layout and field list for JSON, and sends neither', async () => {
    await openExport();

    await click(radio('JSON'));
    await waitFor(() => expect(exportButton()).not.toBeDisabled());

    expect(screen.queryByTestId('export-layout')).toBeNull();
    expect(screen.queryByTestId('export-fields')).toBeNull();
    expect(lastFieldsFilters()).toEqual({});
    await click(exportButton());
    expect(startBody()).toEqual({ format: 'json' });
  });

  it('hides the field list for the unformatted layout, and sends no fields', async () => {
    await openExport();

    await click(radio('4 - Unformatted'));
    await waitFor(() => expect(exportButton()).not.toBeDisabled());

    expect(screen.queryByTestId('export-fields')).toBeNull();
    await click(exportButton());
    expect(startBody()).toEqual({ format: 'csv', layout: 'unFormattedCSVExport' });
  });

  it('sends only the ticked fields', async () => {
    await openExport();

    await act(async () => {
      fireEvent.change(screen.getByRole('textbox', { name: 'Search fields' }), {
        target: { value: 'email' },
      });
    });
    expect(screen.queryByRole('checkbox', { name: 'applicantName' })).toBeNull();
    await click(screen.getByRole('checkbox', { name: 'applicantEmail' }));
    expect(screen.getByTestId('export-fields-count')).toHaveTextContent('2 of 3 fields selected');

    await click(exportButton());

    expect(startBody()).toEqual({
      format: 'csv',
      layout: FIRST_LAYOUT,
      fields: ['form.confirmationId', 'applicantName'],
    });
  });

  it('waits for both dates before reading or exporting a date range', async () => {
    await openExport();
    const reads = getSobaExportFields.mock.calls.length;

    await click(radio('Date range'));

    expect(screen.getByTestId('export-range')).toBeTruthy();
    expect(exportButton()).toBeDisabled();
    expect(getSobaExportFields.mock.calls).toHaveLength(reads);
  });

  it('keeps the dates when switching away from a date range and back, sending them only with it', async () => {
    await openExport();
    await chooseRange();
    await waitFor(() => expect(lastFieldsFilters()).toEqual({ layout: FIRST_LAYOUT, ...RANGE }));
    const entered = segmentValues('export-from');

    await click(radio('All'));
    expect(screen.queryByTestId('export-range')).toBeNull();
    await waitFor(() => expect(exportButton()).not.toBeDisabled());
    await click(exportButton());
    expect(startBody()).toEqual({ format: 'csv', layout: FIRST_LAYOUT });

    await click(radio('Date range'));
    expect(segmentValues('export-from')).toEqual(entered);
    await waitFor(() => expect(exportButton()).not.toBeDisabled());
    await click(exportButton());
    expect(startBody()).toEqual({ format: 'csv', layout: FIRST_LAYOUT, ...RANGE });
  });

  it('offers published and archived versions, not a draft', async () => {
    lookupFormVersions.mockResolvedValue({
      items: [
        { id: 'v1', versionNo: 1, state: 'archived' },
        { id: 'v2', versionNo: 2, state: 'published' },
        { id: 'v3', versionNo: 3, state: 'draft' },
      ],
    });
    await openExport();

    await userEvent.setup().click(within(screen.getByTestId('export-version')).getByRole('button'));

    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'All versions',
      'Version 2',
      'Version 1',
    ]);
  });

  it('sends no field names when every field is ticked', async () => {
    await openExport();
    expect(screen.getByTestId('export-fields-count')).toHaveTextContent('3 of 3 fields selected');

    await click(exportButton());

    expect(startBody()).toEqual({ format: 'csv', layout: FIRST_LAYOUT });
  });

  it('reads the count and fields again on returning to the same filters', async () => {
    await openExport();
    expect(screen.getByTestId('export-submission-count')).toHaveTextContent('12 submissions');
    await click(radio('2 - Multiple rows per submission'));
    await screen.findByTestId('export-fields');
    getSobaExportFields.mockResolvedValue({ fields: [...FIELDS, 'added'], count: 13 });

    await click(radio('1 - Multiple rows per submission with indentation spaces'));

    await waitFor(() =>
      expect(screen.getByTestId('export-submission-count')).toHaveTextContent('13 submissions'),
    );
    expect(screen.getByTestId('export-fields-count')).toHaveTextContent('4 of 4 fields selected');
  });

  it('cannot export while the field list reloads after a filter change', async () => {
    await openExport();
    expect(exportButton()).not.toBeDisabled();
    getSobaExportFields.mockReturnValue(new Promise(() => {}));

    await click(radio('2 - Multiple rows per submission'));

    expect(exportButton()).toBeDisabled();
    expect(screen.queryByTestId('export-fields')).toBeNull();
  });

  it('says so when there are no exports yet', async () => {
    await openExport();

    expect(
      within(screen.getByTestId('export-list')).getByTestId('datatable-empty'),
    ).toHaveTextContent('You have not exported this form yet.');
  });

  it('lists a queued export with its status', async () => {
    listSobaSubmissionExports.mockResolvedValue(listPage([QUEUED]));
    await openExport();

    expect(await screen.findByTestId('export-status-e1')).toHaveTextContent('Queued');
    expect(screen.getByTestId('export-list')).toHaveTextContent('Version 2');
  });

  it('adds the started export to the list', async () => {
    await openExport();
    listSobaSubmissionExports.mockResolvedValue(listPage([QUEUED]));

    await click(exportButton());

    expect(startSobaSubmissionExport).toHaveBeenCalledWith('token', 'f1', expect.anything());
    expect(await screen.findByTestId('export-status-e1')).toHaveTextContent('Queued');
  });

  it('keeps the choices after a failed start', async () => {
    startSobaSubmissionExport.mockRejectedValue(new ApiError('boom', 500));
    await openExport();
    await click(screen.getByRole('checkbox', { name: 'applicantEmail' }));

    await click(exportButton());

    await waitFor(() => expect(exportButton()).not.toBeDisabled());
    expect(radio('CSV').checked).toBe(true);
    expect(screen.getByTestId('export-fields-count')).toHaveTextContent('2 of 3 fields selected');
    expect(screen.queryByTestId('export-status-e1')).toBeNull();
  });

  it('shows a failed field read', async () => {
    getSobaExportFields.mockRejectedValue(new ApiError('boom', 500));
    await renderExport();

    expect(await screen.findByTestId('export-fields-loaderror')).toHaveTextContent(
      'Could not load the fields.',
    );
    expect(exportButton()).toBeDisabled();
  });

  it('shows a refused field read as no access', async () => {
    getSobaExportFields.mockRejectedValue(new ApiError('nope', 403));
    await renderExport();

    expect(await screen.findByTestId('export-fields-loaderror')).toHaveTextContent(
      'You do not have access',
    );
  });

  it('shows a failed list read and still offers the filters', async () => {
    listSobaSubmissionExports.mockRejectedValue(new ApiError('boom', 500));
    await openExport();

    expect(
      await within(screen.getByTestId('export-list')).findByTestId('datatable-error'),
    ).toHaveTextContent('Could not load your exports.');
    expect(exportButton()).not.toBeDisabled();
  });

  it('shows a failed form read', async () => {
    getSobaForm.mockRejectedValue(new ApiError('boom', 500));
    await renderExport();

    expect(await screen.findByTestId('export-form-loaderror')).toHaveTextContent(
      'Could not load the form.',
    );
  });

  it('goes back to the submissions tab', async () => {
    await openExport();

    await click(screen.getByTestId('export-back'));

    expect(mockPush).toHaveBeenCalledWith('/en/build/f1?tab=submissions');
  });

  describe('the list of exports', () => {
    const FUTURE = '2099-11-05T19:00:00.000Z';
    const PAST = '2020-11-05T19:00:00.000Z';
    const READY: SubmissionExportRecord = {
      ...QUEUED,
      id: 'e2',
      status: 'ready',
      finishedAt: '2026-10-20T17:13:44.000Z',
      progress: { done: 5, total: 5 },
      unreadCount: 0,
      result: { state: 'ready', expiresAt: FUTURE, filename: 'Housing 2026-10-20.csv', size: 900 },
    };
    const RUNNING: SubmissionExportRecord = {
      ...QUEUED,
      id: 'e3',
      status: 'running',
      progress: { done: 2, total: 5 },
    };

    const details = (id: string) =>
      screen.queryAllByTestId(`export-detail-${id}`).map((line) => line.textContent);

    it("links a ready export's file and says how long it is kept and how big it is", async () => {
      listSobaSubmissionExports.mockResolvedValue(listPage([READY]));
      await openExport();

      expect(await screen.findByTestId('export-status-e2')).toHaveTextContent('Ready');
      expect(details('e2').join(' ')).toContain('Ready until');
      expect(details('e2')).toContain('900 bytes');
      expect(screen.getByTestId('export-download-e2')).toHaveAttribute(
        'href',
        '/en/build/f1/submissions/exports/e2/file',
      );
      expect(screen.queryByTestId('export-stop-e2')).toBeNull();
    });

    it('shows a ready export past its expiry as expired, with no link', async () => {
      listSobaSubmissionExports.mockResolvedValue(
        listPage([{ ...READY, result: { ...READY.result!, expiresAt: PAST } }]),
      );
      await openExport();

      expect(await screen.findByTestId('export-status-e2')).toHaveTextContent('Expired');
      expect(screen.queryByTestId('export-download-e2')).toBeNull();
    });

    it.each([
      ['too_large', 'over the size limit'],
      ['access_lost', 'no longer read'],
      ['error', 'Something went wrong'],
    ] as const)('says why a failed export ended (%s)', async (endReason, said) => {
      listSobaSubmissionExports.mockResolvedValue(
        listPage([{ ...QUEUED, status: 'failed', endReason }]),
      );
      await openExport();

      expect(await screen.findByTestId('export-status-e1')).toHaveTextContent('Failed');
      expect(details('e1').join(' ')).toContain(said);
    });

    it('says how many submissions could not be read, one or more', async () => {
      listSobaSubmissionExports.mockResolvedValue(
        listPage([
          { ...READY, unreadCount: 3 },
          { ...READY, id: 'e4', unreadCount: 1 },
        ]),
      );
      await openExport();

      await screen.findByTestId('export-status-e2');
      expect(details('e2').join(' ')).toContain('3 submissions could not be read');
      expect(details('e4').join(' ')).toContain('1 submission could not be read and was left out.');
    });

    it('asks the server for the first page newest first, and counts every page it has', async () => {
      const firstTen = Array.from({ length: 10 }, (_, index) => ({ ...READY, id: `p${index}` }));
      listSobaSubmissionExports.mockResolvedValue(listPage(firstTen, 12));
      await openExport();

      await screen.findByTestId('export-status-p0');
      expect(listSobaSubmissionExports).toHaveBeenLastCalledWith('token', 'f1', {
        offset: 0,
        limit: 10,
        sort: 'createdAt:desc',
      });
      expect(screen.getByTestId('datatable-next-page-button')).not.toBeDisabled();
    });

    // The page and sort live in the URL, under this list's own names.
    it('reads the page and the sort a link names', async () => {
      window.history.replaceState(
        null,
        '',
        '/en/build/f1/submissions/exports?submissionExports.page=2&submissionExports.sort=createdAt:asc',
      );
      listSobaSubmissionExports.mockResolvedValue({
        ...listPage([{ ...READY, id: 'p10' }], 11),
        page: { offset: 10, limit: 10, total: 11 },
      });
      try {
        await openExport();

        expect(await screen.findByTestId('export-status-p10')).toBeInTheDocument();
        expect(listSobaSubmissionExports).toHaveBeenLastCalledWith('token', 'f1', {
          offset: 10,
          limit: 10,
          sort: 'createdAt:asc',
        });
        expect(screen.getByRole('columnheader', { name: /Started/ })).toHaveAttribute(
          'aria-sort',
          'ascending',
        );
      } finally {
        window.history.replaceState(null, '', '/');
      }
    });

    it('keeps the rows and says so once when reading the list again is refused', async () => {
      listSobaSubmissionExports.mockResolvedValueOnce(listPage([READY]));
      await openExport();
      await screen.findByTestId('export-status-e2');
      listSobaSubmissionExports.mockRejectedValue(new ApiError('nope', 403));

      await click(exportButton());

      await waitFor(() => expect(notifications().join(' ')).toContain('You do not have access'));
      expect(screen.getByTestId('export-status-e2')).toHaveTextContent('Ready');
    });

    it('shows a running export with its progress, and stops it after confirming', async () => {
      const stopAsked = { ...RUNNING, cancelRequestedAt: '2026-10-20T17:14:00.000Z' };
      listSobaSubmissionExports.mockResolvedValue(listPage([RUNNING]));
      stopSobaSubmissionExport.mockResolvedValue({ stopped: false, export: stopAsked });
      await openExport();

      expect(await screen.findByTestId('export-status-e3')).toHaveTextContent('Running');
      expect(details('e3')).toContain('2 of 5 submissions');
      listSobaSubmissionExports.mockResolvedValue(listPage([stopAsked]));
      await click(screen.getByTestId('export-stop-e3'));
      expect(screen.getByTestId('confirm-modal-cancel')).toHaveTextContent('Keep running');
      await click(screen.getByTestId('confirm-modal-confirm'));

      expect(stopSobaSubmissionExport).toHaveBeenCalledWith('token', 'f1', 'e3');
      await waitFor(() => expect(details('e3')).toContain('Stopping…'));
      expect(screen.queryByTestId('export-stop-e3')).toBeNull();
      expect(notifications()).toContain('Stop requested. The export stops at its next check.');
    });

    it('says an export already finished when the stop comes too late, and reads the list again', async () => {
      listSobaSubmissionExports.mockResolvedValue(listPage([RUNNING]));
      stopSobaSubmissionExport.mockRejectedValue(new ApiError('finished', 409));
      await openExport();
      await screen.findByTestId('export-stop-e3');
      const reads = listSobaSubmissionExports.mock.calls.length;

      await click(screen.getByTestId('export-stop-e3'));
      await click(screen.getByTestId('confirm-modal-confirm'));

      await waitFor(() => expect(notifications()).toContain('The export had already finished.'));
      expect(listSobaSubmissionExports.mock.calls.length).toBeGreaterThan(reads);
    });

    it('reads the list again every few seconds while an export runs, and stops once none does', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        listSobaSubmissionExports.mockResolvedValue(listPage([RUNNING]));
        await openExport();
        expect(await screen.findByTestId('export-status-e3')).toHaveTextContent('Running');

        listSobaSubmissionExports.mockResolvedValue(listPage([{ ...READY, id: 'e3' }]));
        await act(async () => {
          await vi.advanceTimersByTimeAsync(5_000);
        });
        await waitFor(() =>
          expect(screen.getByTestId('export-status-e3')).toHaveTextContent('Ready'),
        );
        const reads = listSobaSubmissionExports.mock.calls.length;
        await act(async () => {
          await vi.advanceTimersByTimeAsync(15_000);
        });
        expect(listSobaSubmissionExports).toHaveBeenCalledTimes(reads);
      } finally {
        vi.useRealTimers();
      }
    });

    it('keeps the exports shown when reading them again fails', async () => {
      listSobaSubmissionExports.mockResolvedValueOnce(listPage([READY]));
      await openExport();
      await screen.findByTestId('export-status-e2');
      listSobaSubmissionExports.mockRejectedValue(new ApiError('boom', 503));

      await click(exportButton());

      await waitFor(() => expect(notifications()).toContain('Could not load your exports.'));
      expect(screen.getByTestId('export-status-e2')).toHaveTextContent('Ready');
    });

    it('says the limit is reached when the server refuses another export', async () => {
      startSobaSubmissionExport.mockRejectedValue(
        new ApiError('Too many', 429, 'export_limit_reached'),
      );
      await openExport();

      await click(exportButton());

      await waitFor(() =>
        expect(notifications()).toContain(
          "This form has as many exports running as allowed, yours and others'. Start another when one finishes.",
        ),
      );
    });
  });
});
