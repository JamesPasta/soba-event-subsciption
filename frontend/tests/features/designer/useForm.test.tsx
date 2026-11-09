import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { SWRConfig } from 'swr';

const getSobaForm = vi.fn();
const lookupFormVersions = vi.fn();
const getSobaFormVersion = vi.fn();
const getFormVersionSchema = vi.fn();
const createFormVersion = vi.fn();
const saveFormVersionSchema = vi.fn();
vi.mock('@/src/shared/api/sobaApi', () => ({
  getSobaForm: (...args: unknown[]) => getSobaForm(...args),
  lookupFormVersions: (...args: unknown[]) => lookupFormVersions(...args),
  getSobaFormVersion: (...args: unknown[]) => getSobaFormVersion(...args),
  getFormVersionSchema: (...args: unknown[]) => getFormVersionSchema(...args),
  createFormVersion: (...args: unknown[]) => createFormVersion(...args),
  saveFormVersionSchema: (...args: unknown[]) => saveFormVersionSchema(...args),
}));

import makeStore from '@/lib/store';
import { setAuthenticated, setToken } from '@/lib/slices/keycloakSlice';
import { useForm, useFormWriter } from '@/src/features/designer/data/useForm';
import { ApiError } from '@/src/shared/api/sobaHelpers';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const V1 = { id: 'v1', versionNo: 1, state: 'published' };
const V2 = { id: 'v2', versionNo: 2, state: 'draft' };
const V3 = { id: 'v3', versionNo: 3, state: 'draft' };

let store: ReturnType<typeof makeStore>;

function wrapper({ children }: { children: React.ReactNode }) {
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

describe('useForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store = makeStore();
    store.dispatch(setToken('token'));
    store.dispatch(setAuthenticated(true));
    getSobaForm.mockResolvedValue({ id: 'f1', name: 'Form', description: '', currentVersion: V2 });
    lookupFormVersions.mockResolvedValue({ items: [V2, V1], limit: 500, truncated: false });
    getSobaFormVersion.mockImplementation((_token: string, id: string) =>
      Promise.resolve([V1, V2].find((v) => v.id === id)),
    );
    getFormVersionSchema.mockResolvedValue({ components: [] });
  });

  // "Design" on the current version's history row would otherwise open the draft read-only.
  it('opens the current version as the editable draft when it is selected by id', async () => {
    const { result } = renderHook(() => useForm('f1'), { wrapper });
    await waitFor(() => expect(result.current.currentVersion?.id).toBe('v2'));

    act(() => result.current.selectVersion('v2'));

    expect(result.current.selectedVersionId).toBe('current');
    expect(result.current.isHistoryView).toBe(false);
    expect(getSobaFormVersion).not.toHaveBeenCalled();
  });

  // Edits made on v2 must not be saved onto a v3 someone else created.
  it('reports unsaved edits as stale once the current version moves on', async () => {
    const { result } = renderHook(() => useForm('f1'), { wrapper });
    await waitFor(() => expect(result.current.currentVersion?.id).toBe('v2'));

    act(() => result.current.setName('Renamed'));
    expect(result.current.editsStale).toBe(false);

    getSobaForm.mockResolvedValue({ id: 'f1', name: 'Form', description: '', currentVersion: V3 });
    await act(async () => {
      await result.current.refreshForm();
    });

    await waitFor(() => expect(result.current.currentVersion?.id).toBe('v3'));
    expect(result.current.editsStale).toBe(true);

    act(() => result.current.discardEdits());
    expect(result.current.editsStale).toBe(false);
  });

  // A new version takes the templates of the version its schema came from.
  it('names the version the unsaved schema edits were made on as their source', async () => {
    const { result } = renderHook(() => useForm('f1'), { wrapper });
    await waitFor(() => expect(result.current.currentVersion?.id).toBe('v2'));
    expect(result.current.schemaVersionId).toBe('v2');

    act(() => result.current.setSchema({ components: [{ key: 'edited' }] } as never));
    getSobaForm.mockResolvedValue({ id: 'f1', name: 'Form', description: '', currentVersion: V3 });
    await act(async () => {
      await result.current.refreshForm();
    });

    await waitFor(() => expect(result.current.currentVersion?.id).toBe('v3'));
    expect(result.current.schemaVersionId).toBe('v2');

    act(() => result.current.discardEdits());
    expect(result.current.schemaVersionId).toBe('v3');
  });

  // The server starts the draft from the source version's schema, so the browser never reads it.
  it('restores a version as a new draft from that version, in one request', async () => {
    createFormVersion.mockResolvedValue({ value: V3, created: true });
    const { result } = renderHook(() => useFormWriter('f1'), { wrapper });

    await act(async () => {
      await result.current.restoreVersion('token', 'v1');
    });

    expect(createFormVersion).toHaveBeenCalledWith('token', {
      id: expect.stringMatching(UUID_V7),
      formId: 'f1',
      fromFormVersionId: 'v1',
    });
    expect(getFormVersionSchema).not.toHaveBeenCalled();
    expect(saveFormVersionSchema).not.toHaveBeenCalled();
  });

  // A retry with the same id returns the draft the first attempt made, rather than a second one, even
  // when the schema was edited in between.
  it('sends the same id when a failed new version is tried again after an edit, and a new id after one lands', async () => {
    createFormVersion
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue({ value: V3, created: true });
    const { result } = renderHook(() => useFormWriter('f1'), { wrapper });
    const schema = { components: [] } as never;
    const edited = { components: [{ key: 'edited' }] } as never;

    await act(async () => {
      await expect(result.current.createVersion('token', schema, 'v2')).rejects.toThrow();
    });
    await act(async () => {
      await result.current.createVersion('token', edited, 'v2');
    });
    await act(async () => {
      await result.current.createVersion('token', schema, 'v2');
    });

    const [failed, retried, next] = createFormVersion.mock.calls.map((call) => call[1].id);
    expect(failed).toMatch(UUID_V7);
    expect(retried).toBe(failed);
    expect(next).not.toBe(failed);
    expect(saveFormVersionSchema).not.toHaveBeenCalled();
  });

  // The first attempt committed but its response was lost, so the draft it returns may hold the
  // schema from before the edit.
  it('saves the schema sent on a retry that got back an earlier draft', async () => {
    createFormVersion.mockResolvedValue({ value: V3, created: false });
    saveFormVersionSchema.mockResolvedValue(V3);
    const { result } = renderHook(() => useFormWriter('f1'), { wrapper });
    const edited = { components: [{ key: 'edited' }] } as never;

    await act(async () => {
      await result.current.createVersion('token', edited, 'v2');
    });

    expect(saveFormVersionSchema).toHaveBeenCalledWith('token', 'v3', edited);
  });

  // A refusal answers the request, so trying again is a new create under a new id.
  it('mints a new id after a new version is refused', async () => {
    createFormVersion
      .mockRejectedValueOnce(new ApiError('Form version id already in use', 409))
      .mockResolvedValue({ value: V3, created: true });
    const { result } = renderHook(() => useFormWriter('f1'), { wrapper });
    const schema = { components: [] } as never;

    await act(async () => {
      await expect(result.current.createVersion('token', schema, 'v2')).rejects.toThrow();
    });
    await act(async () => {
      await result.current.createVersion('token', schema, 'v2');
    });

    const [refused, next] = createFormVersion.mock.calls.map((call) => call[1].id);
    expect(next).not.toBe(refused);
  });

  it('opens an older version as history, read by id', async () => {
    const { result } = renderHook(() => useForm('f1'), { wrapper });
    await waitFor(() => expect(result.current.currentVersion?.id).toBe('v2'));

    act(() => result.current.selectVersion('v1'));

    expect(result.current.isHistoryView).toBe(true);
    await waitFor(() => expect(result.current.activeVersion?.id).toBe('v1'));
    expect(getSobaFormVersion).toHaveBeenCalledWith('token', 'v1');
  });
});
