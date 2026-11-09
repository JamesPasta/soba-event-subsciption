import React, { act } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';

const { mockSaveBlob } = vi.hoisted(() => ({ mockSaveBlob: vi.fn() }));

vi.mock('@/app/[lang]/Providers', async () => {
  const dict = { ...(await import('@/dictionaries/en.json')).default, locale: 'en' };
  return { useDictionary: () => dict };
});

vi.mock('@/src/shared/util/saveBlob', () => ({
  saveBlob: (...args: unknown[]) => mockSaveBlob(...args),
}));

import makeStore from '@/lib/store';
import { setAuthenticated, setToken } from '@/lib/slices/keycloakSlice';
import { NetworkError } from '@/src/shared/api/sobaFetch';
import { ApiError } from '@/src/shared/api/sobaHelpers';
import { FileDownload } from '@/src/shared/ui/FileDownload';

const load = vi.fn();

async function renderDownload() {
  const store = makeStore();
  store.dispatch(setToken('token'));
  store.dispatch(setAuthenticated(true));
  await act(async () => {
    render(
      <Provider store={store}>
        <FileDownload load={load} />
      </Provider>,
    );
  });
}

describe('FileDownload', () => {
  beforeEach(() => vi.clearAllMocks());

  it('saves the file once it is read, and again on request', async () => {
    const file = { blob: new Blob(['pdf']), filename: 'plan.pdf' };
    load.mockResolvedValue(file);

    await renderDownload();

    expect(await screen.findByTestId('file-download-saved')).toHaveTextContent(
      'plan.pdf is ready. If it did not save, use Download again.',
    );
    expect(load).toHaveBeenCalledWith('token');
    expect(mockSaveBlob).toHaveBeenCalledTimes(1);
    expect(mockSaveBlob).toHaveBeenCalledWith(file.blob, 'plan.pdf');

    await act(async () => {
      fireEvent.click(screen.getByTestId('file-download-again'));
    });
    expect(mockSaveBlob).toHaveBeenCalledTimes(2);
  });

  it('shows a refused read as no access, and saves nothing', async () => {
    load.mockRejectedValue(new ApiError('nope', 403));

    await renderDownload();

    expect(await screen.findByTestId('file-download-loaderror')).toHaveTextContent(
      'You do not have access',
    );
    expect(screen.queryByTestId('file-download-retry')).toBeNull();
    expect(mockSaveBlob).not.toHaveBeenCalled();
  });

  it('shows a missing file as not found, with no retry', async () => {
    load.mockRejectedValue(new ApiError('File not found', 404, 'file_not_found'));

    await renderDownload();

    expect(await screen.findByTestId('file-download-notfound')).toHaveTextContent(
      'This file could not be found.',
    );
    expect(screen.queryByTestId('file-download-retry')).toBeNull();
    expect(mockSaveBlob).not.toHaveBeenCalled();
  });

  it.each([
    ['a refused request', new ApiError('Invalid file id', 400, 'request_invalid')],
    ['an error that is not from the API', new TypeError('x is undefined')],
  ])('offers no retry for %s', async (_label, cause) => {
    load.mockRejectedValue(cause);

    await renderDownload();

    expect(await screen.findByTestId('file-download-loaderror')).toHaveTextContent(
      'Could not download this file.',
    );
    expect(screen.queryByTestId('file-download-retry')).toBeNull();
  });

  it('offers a retry when the request never reached the server', async () => {
    load.mockRejectedValue(new NetworkError(new TypeError('Failed to fetch')));

    await renderDownload();

    expect(await screen.findByTestId('file-download-retry')).toBeInTheDocument();
  });

  it('offers a retry when the stored file is unavailable, and saves it once read', async () => {
    const file = { blob: new Blob(['pdf']), filename: 'plan.pdf' };
    let finish!: (value: typeof file) => void;
    load
      .mockRejectedValueOnce(new ApiError('File content unavailable', 503, 'file_unavailable'))
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );

    await renderDownload();

    expect(await screen.findByTestId('file-download-loaderror')).toHaveTextContent(
      'Could not download this file.',
    );
    expect(mockSaveBlob).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByTestId('file-download-retry'));
    });
    // The retry shows progress, with no second button to press.
    expect(screen.getByRole('progressbar', { name: 'Downloading the file…' })).toBeInTheDocument();
    expect(screen.queryByTestId('file-download-retry')).toBeNull();

    await act(async () => {
      finish(file);
    });
    expect(await screen.findByTestId('file-download-saved')).toHaveTextContent(
      'plan.pdf is ready.',
    );
    expect(mockSaveBlob).toHaveBeenCalledTimes(1);
    expect(mockSaveBlob).toHaveBeenCalledWith(file.blob, 'plan.pdf');
  });
});
