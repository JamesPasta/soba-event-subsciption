import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const h = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: h.refresh }),
}));

import AppError from '@/app/error';

describe('AppError', () => {
  // The failure was the server's render, so resetting without a fresh one shows it again.
  it('fetches the page from the server again, then resets, when asked to try again', async () => {
    const reset = vi.fn();
    render(<AppError error={new Error('features meta')} reset={reset} />);
    await userEvent.click(screen.getByTestId('app-error-retry'));
    expect(h.refresh).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledTimes(1);
    expect(h.refresh.mock.invocationCallOrder[0]).toBeLessThan(reset.mock.invocationCallOrder[0]);
  });
});
