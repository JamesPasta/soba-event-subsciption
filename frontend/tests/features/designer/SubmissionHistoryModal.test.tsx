import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/app/[lang]/Providers', async () => {
  const dict = { ...(await import('@/dictionaries/en.json')).default, locale: 'en' };
  return { useDictionary: () => dict };
});

import { SubmissionHistoryModal } from '@/src/features/designer/ui/SubmissionHistoryModal';

type Row = { id: string; who: string };
const ROWS: Row[] = Array.from({ length: 7 }, (_, i) => ({
  id: `r${i + 1}`,
  who: `Person ${i + 1}`,
}));
const COLUMNS = [{ key: 'who', label: 'Username' }];

function renderModal(
  props: Partial<React.ComponentProps<typeof SubmissionHistoryModal<Row>>> = {},
) {
  const onClose = vi.fn();
  render(
    <SubmissionHistoryModal<Row>
      show
      title="Submitted Data History"
      columns={COLUMNS}
      rows={ROWS}
      onClose={onClose}
      {...props}
    />,
  );
  return onClose;
}

describe('SubmissionHistoryModal', () => {
  it('renders nothing while closed', () => {
    renderModal({ show: false });

    expect(screen.queryByText('Person 1')).not.toBeInTheDocument();
  });

  it('shows the first page of a history longer than a page, then the rest', async () => {
    const user = userEvent.setup();
    renderModal();

    expect(screen.getByText('Person 5')).toBeInTheDocument();
    expect(screen.queryByText('Person 6')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('datatable-next-page-button'));

    expect(screen.getByText('Person 7')).toBeInTheDocument();
    expect(screen.queryByText('Person 1')).not.toBeInTheDocument();
  });

  it('shows the introduction only when one is given', () => {
    renderModal({ intro: 'This is an audit log.' });

    expect(screen.getByTestId('submission-history-intro')).toHaveTextContent(
      'This is an audit log.',
    );
  });

  it('leaves the introduction out otherwise', () => {
    renderModal();

    expect(screen.queryByTestId('submission-history-intro')).not.toBeInTheDocument();
  });

  it('closes from its Close button', async () => {
    const user = userEvent.setup();
    const onClose = renderModal();

    await user.click(screen.getByTestId('submission-history-close'));

    expect(onClose).toHaveBeenCalled();
  });
});
