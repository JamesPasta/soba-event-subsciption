import React, { act } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';

const { mockDownload } = vi.hoisted(() => ({ mockDownload: vi.fn() }));

vi.mock('@/app/[lang]/Providers', async () => {
  const dict = { ...(await import('@/dictionaries/en.json')).default, locale: 'en' };
  return { useDictionary: () => dict };
});

vi.mock('next/navigation', () => ({
  usePathname: () => '/en/build/f1/submissions/exports/e1/file',
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/src/shared/api/sobaApi', () => ({
  downloadSobaSubmissionExport: (...args: unknown[]) => mockDownload(...args),
}));

vi.mock('@/src/shared/util/saveBlob', () => ({ saveBlob: vi.fn() }));

import makeStore from '@/lib/store';
import { setAuthenticated, setToken } from '@/lib/slices/keycloakSlice';
import { ApiError } from '@/src/shared/api/sobaHelpers';
import { SubmissionExportDownload } from '@/src/features/designer/ui/SubmissionExportDownload';

async function renderDownload() {
  const store = makeStore();
  store.dispatch(setToken('token'));
  store.dispatch(setAuthenticated(true));
  await act(async () => {
    render(
      <Provider store={store}>
        <SubmissionExportDownload formId="f1" exportId="e1" />
      </Provider>,
    );
  });
}

describe('SubmissionExportDownload', () => {
  beforeEach(() => vi.clearAllMocks());

  it("saves the reader's export and links back to the exports page", async () => {
    mockDownload.mockResolvedValue({ blob: new Blob(['a,b']), filename: 'Housing 2026-10-20.csv' });
    await renderDownload();

    expect(await screen.findByTestId('file-download-saved')).toHaveTextContent(
      'Housing 2026-10-20.csv',
    );
    expect(mockDownload).toHaveBeenCalledWith('token', 'f1', 'e1');
    expect(screen.getByTestId('export-file-back')).toHaveAttribute(
      'href',
      '/en/build/f1/submissions/exports',
    );
  });

  it('says an export that is gone is no longer available', async () => {
    mockDownload.mockRejectedValue(new ApiError('gone', 404, 'file_not_found'));
    await renderDownload();

    expect(await screen.findByTestId('file-download-notfound')).toHaveTextContent(
      'This export is no longer available. Start a new one.',
    );
  });
});
