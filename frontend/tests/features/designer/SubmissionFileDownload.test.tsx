import React, { act } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';

const { mockPush, mockDownload } = vi.hoisted(() => ({ mockPush: vi.fn(), mockDownload: vi.fn() }));

vi.mock('@/app/[lang]/Providers', async () => {
  const dict = { ...(await import('@/dictionaries/en.json')).default, locale: 'en' };
  return { useDictionary: () => dict };
});

vi.mock('next/navigation', () => ({
  usePathname: () => '/en/build/f1/submissions/sub-1/files/file-1',
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('@/src/shared/api/sobaApi', () => ({
  downloadSobaSubmissionFile: (...args: unknown[]) => mockDownload(...args),
}));

vi.mock('@/src/shared/util/saveBlob', () => ({ saveBlob: vi.fn() }));

import makeStore from '@/lib/store';
import { setAuthenticated, setToken } from '@/lib/slices/keycloakSlice';
import { SubmissionFileDownload } from '@/src/features/designer/ui/SubmissionFileDownload';

describe('SubmissionFileDownload', () => {
  it('reads the file for staff and links back to the submission', async () => {
    mockDownload.mockResolvedValue({ blob: new Blob(['pdf']), filename: 'plan.pdf' });
    const store = makeStore();
    store.dispatch(setToken('token'));
    store.dispatch(setAuthenticated(true));

    await act(async () => {
      render(
        <Provider store={store}>
          <SubmissionFileDownload formId="f1" submissionId="sub-1" fileId="file-1" />
        </Provider>,
      );
    });

    expect(await screen.findByTestId('file-download-saved')).toHaveTextContent('plan.pdf');
    expect(mockDownload).toHaveBeenCalledWith('token', 'sub-1', 'file-1');

    fireEvent.click(screen.getByTestId('submission-file-back'));
    expect(mockPush).toHaveBeenCalledWith('/en/build/f1/submissions/sub-1');
  });
});
