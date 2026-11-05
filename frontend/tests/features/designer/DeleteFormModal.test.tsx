import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import en from '@/dictionaries/en.json';
import { ApiError } from '@/src/shared/api/sobaHelpers';

const mocks = vi.hoisted(() => ({ remove: vi.fn(), close: vi.fn(), notify: vi.fn() }));
vi.mock('@/app/[lang]/Providers', () => ({ useDictionary: () => en }));
vi.mock('@/lib/hooks/useKeycloak', () => ({ useKeycloak: () => ({ token: 'token' }) }));
vi.mock('@/lib/hooks/useNotificationStore', () => ({
  useNotificationStore: () => ({ addNotification: mocks.notify }),
}));
vi.mock('@/src/features/designer/data/useForm', () => ({
  useFormWriter: () => ({ remove: mocks.remove }),
}));

import { DeleteFormModal } from '@/src/features/designer/ui/DeleteFormModal';

describe('DeleteFormModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.remove.mockResolvedValue(undefined);
  });

  const open = () => {
    render(<DeleteFormModal formId="f1" name="Survey" onClose={mocks.close} />);
  };

  it('names the form and allows cancellation without deleting', () => {
    open();
    expect(screen.getByTestId('confirm-modal-message')).toHaveTextContent('Survey');
    expect(mocks.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('confirm-modal-cancel'));
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it('waits for deletion before reporting success and closing the modal', async () => {
    let finish!: () => void;
    mocks.remove.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    open();
    fireEvent.click(screen.getByTestId('confirm-modal-confirm'));
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith('token');
    expect(screen.getByTestId('confirm-modal-confirm')).toBeDisabled();
    expect(screen.getByTestId('confirm-modal-cancel')).toBeDisabled();
    expect(mocks.close).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(mocks.notify).toHaveBeenCalledWith({ text: en.form.deleteSuccess, type: 'success' });
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it('keeps the confirmation open and reports a permission refusal', async () => {
    mocks.remove.mockRejectedValue(new ApiError('Forbidden', 403));
    open();
    fireEvent.click(screen.getByTestId('confirm-modal-confirm'));
    await waitFor(() =>
      expect(mocks.notify).toHaveBeenCalledWith(
        expect.objectContaining({ text: en.general.noAccess, type: 'error' }),
      ),
    );
    expect(mocks.close).not.toHaveBeenCalled();
    expect(screen.getByTestId('confirm-modal-confirm')).toBeEnabled();
  });
});
