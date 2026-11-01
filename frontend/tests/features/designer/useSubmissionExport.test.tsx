import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { SWRConfig } from 'swr';

const getSobaExportFields = vi.fn();
const listSobaSubmissionExports = vi.fn();
const startSobaSubmissionExport = vi.fn();

vi.mock('@/src/shared/api/sobaApi', () => ({
  getSobaForm: vi.fn(),
  lookupFormVersions: vi.fn(),
  getSobaExportFields: (...args: unknown[]) => getSobaExportFields(...args),
  listSobaSubmissionExports: (...args: unknown[]) => listSobaSubmissionExports(...args),
  startSobaSubmissionExport: (...args: unknown[]) => startSobaSubmissionExport(...args),
}));

import makeStore from '@/lib/store';
import { setAuthenticated, setToken } from '@/lib/slices/keycloakSlice';
import { ApiError } from '@/src/shared/api/sobaHelpers';
import {
  useExportFields,
  useSubmissionExportStarter,
  useSubmissionExports,
} from '@/src/features/designer/data/useSubmissionExport';
import type { SubmissionExport, SubmissionExportFieldsBody } from '@/src/types/submissionExport';

const FILTERS: SubmissionExportFieldsBody = { layout: 'multiRowEmptySpacesCSVExport' };

const QUEUED: SubmissionExport = {
  id: 'e1',
  formId: 'f1',
  format: 'csv',
  status: 'queued',
  createdAt: '2026-10-20T17:12:44.000Z',
  finishedAt: null,
  cancelRequestedAt: null,
};

function wrapper({ children }: { children: React.ReactNode }) {
  const store = makeStore();
  store.dispatch(setToken('token'));
  store.dispatch(setAuthenticated(true));
  return (
    <Provider store={store}>
      <SWRConfig
        value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}
      >
        {children}
      </SWRConfig>
    </Provider>
  );
}

describe('useExportFields', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads the fields for the filters once', async () => {
    getSobaExportFields.mockResolvedValue({ fields: ['applicantName'], count: 2 });

    const { result } = renderHook(() => useExportFields('f1', FILTERS), { wrapper });

    await waitFor(() => expect(result.current.data?.fields).toEqual(['applicantName']));
    expect(getSobaExportFields).toHaveBeenCalledTimes(1);
    expect(getSobaExportFields).toHaveBeenCalledWith('token', 'f1', FILTERS);
  });

  describe('on returning to the same filters', () => {
    const openAndLeave = async () => {
      getSobaExportFields.mockResolvedValueOnce({ fields: ['old'], count: 1 });
      const view = renderHook(({ filters }) => useExportFields('f1', filters), {
        wrapper,
        initialProps: { filters: FILTERS as SubmissionExportFieldsBody | null },
      });
      await waitFor(() => expect(view.result.current.data?.count).toBe(1));
      view.rerender({ filters: null });
      return view;
    };

    it('reads again, with no data until that read answers', async () => {
      const { result, rerender } = await openAndLeave();
      let answer: (value: unknown) => void = () => {};
      getSobaExportFields.mockReturnValueOnce(
        new Promise((resolve) => {
          answer = resolve;
        }),
      );

      rerender({ filters: FILTERS });

      await waitFor(() => expect(getSobaExportFields).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(result.current.data).toBeNull());
      await act(async () => answer({ fields: ['old', 'new'], count: 2 }));
      await waitFor(() =>
        expect(result.current.data).toEqual({ fields: ['old', 'new'], count: 2 }),
      );
    });

    it('gives no data when that read fails', async () => {
      const { result, rerender } = await openAndLeave();
      getSobaExportFields.mockRejectedValueOnce(new ApiError('nope', 500));

      rerender({ filters: FILTERS });

      await waitFor(() => expect(result.current.error?.kind).toBe('failed'));
      expect(result.current.data).toBeNull();
    });
  });

  it('waits while the filters are incomplete', async () => {
    const { result } = renderHook(() => useExportFields('f1', null), { wrapper });

    await act(async () => {});
    expect(result.current.data).toBeNull();
    expect(getSobaExportFields).not.toHaveBeenCalled();
  });

  it.each([
    [403, 'forbidden'],
    [500, 'failed'],
  ])('classifies a %s read as %s', async (status, kind) => {
    getSobaExportFields.mockRejectedValue(new ApiError('no', status));

    const { result } = renderHook(() => useExportFields('f1', FILTERS), { wrapper });

    await waitFor(() => expect(result.current.error?.kind).toBe(kind));
    expect(result.current.data).toBeNull();
  });
});

const QUERY = { offset: 10, limit: 10, sort: 'createdAt:desc' };
const listPage = (items: SubmissionExport[], total = items.length) => ({
  items,
  page: { offset: 0, limit: 10, total },
  sort: 'createdAt:desc',
});

describe('useSubmissionExports', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads one page of my exports once, and gives the total the server counts', async () => {
    listSobaSubmissionExports.mockResolvedValue(listPage([QUEUED], 11));

    const { result } = renderHook(() => useSubmissionExports('f1', QUERY), { wrapper });

    await waitFor(() => expect(result.current.rows).toEqual([QUEUED]));
    expect(result.current.total).toBe(11);
    expect(listSobaSubmissionExports).toHaveBeenCalledTimes(1);
    expect(listSobaSubmissionExports).toHaveBeenCalledWith('token', 'f1', QUERY);
  });

  it.each([
    [403, 'forbidden'],
    [500, 'failed'],
  ])('classifies a %s read as %s', async (status, kind) => {
    listSobaSubmissionExports.mockRejectedValue(new ApiError('no', status));

    const { result } = renderHook(() => useSubmissionExports('f1', QUERY), { wrapper });

    await waitFor(() => expect(result.current.error?.kind).toBe(kind));
    expect(result.current.rows).toEqual([]);
  });
});

describe('useSubmissionExportStarter', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the queued export and re-reads the list', async () => {
    listSobaSubmissionExports.mockResolvedValue(listPage([]));
    startSobaSubmissionExport.mockResolvedValue(QUEUED);

    const { result } = renderHook(
      () => ({
        list: useSubmissionExports('f1', QUERY),
        starter: useSubmissionExportStarter('f1'),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.list.total).toBe(0));
    listSobaSubmissionExports.mockResolvedValue(listPage([QUEUED]));

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.starter.start('token', { format: 'csv' });
    });

    expect(outcome).toEqual({ status: 'applied', value: QUEUED });
    await waitFor(() => expect(result.current.list.rows).toEqual([QUEUED]));
  });

  it('throws a failed start to the caller', async () => {
    startSobaSubmissionExport.mockRejectedValue(new ApiError('boom', 500));

    const { result } = renderHook(() => useSubmissionExportStarter('f1'), { wrapper });

    await expect(result.current.start('token', { format: 'json' })).rejects.toThrow('boom');
  });
});
