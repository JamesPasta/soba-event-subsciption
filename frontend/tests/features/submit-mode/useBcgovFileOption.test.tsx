import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  filesEnabled: true,
  registrationFails: false,
  release: undefined as undefined | (() => void),
}));

vi.mock('@/src/features/formio-v5/registerBcgovFormio', () => ({
  ensureBcgovFormioRegistered: () =>
    h.registrationFails
      ? Promise.reject(new Error('chunk failed to load'))
      : Promise.resolve({ filesEnabled: h.filesEnabled }),
}));
vi.mock('@/src/features/formio-v5/loadFilesConfig', async () => ({
  ...(await vi.importActual<object>('@/src/features/formio-v5/loadFilesConfig')),
  loadFilesConfig: () =>
    new Promise((resolve) => {
      h.release = () => resolve({ blockedExtensions: ['.exe'], maxFileSizeMb: 25 });
    }),
}));

import {
  FILE_LIMITS_WAIT_MS,
  useBcgovFileOption,
} from '@/src/features/formio-v5/useBcgovFileOption';

beforeEach(() => {
  h.filesEnabled = true;
  h.registrationFails = false;
  h.release = undefined;
});

describe('useBcgovFileOption', () => {
  it('is not ready until the file limits load, then carries them', async () => {
    const { result } = renderHook(() => useBcgovFileOption());
    expect(result.current).toEqual({ option: {}, ready: false });
    await waitFor(() => expect(h.release).toBeDefined());
    expect(result.current.ready).toBe(false);
    h.release!();
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.option).toEqual({
      bcgovFile: { blockedExtensions: ['.exe'], fileMaxSize: '25MB' },
    });
  });

  it('is ready with no limits when the file components fail to register', async () => {
    h.registrationFails = true;
    const { result } = renderHook(() => useBcgovFileOption());
    await waitFor(() => expect(result.current).toEqual({ option: {}, ready: true }));
  });

  describe('when the file limits never arrive', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('stops waiting and is ready with no limits', async () => {
      const { result } = renderHook(() => useBcgovFileOption());
      await act(() => vi.advanceTimersByTimeAsync(FILE_LIMITS_WAIT_MS - 1));
      expect(result.current.ready).toBe(false);
      await act(() => vi.advanceTimersByTimeAsync(1));
      expect(result.current).toEqual({ option: {}, ready: true });
    });
  });

  it('is ready with no limits when files are off', async () => {
    h.filesEnabled = false;
    const { result } = renderHook(() => useBcgovFileOption());
    await waitFor(() => expect(result.current).toEqual({ option: {}, ready: true }));
  });
});
