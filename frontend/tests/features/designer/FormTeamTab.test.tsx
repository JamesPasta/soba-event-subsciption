import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import dict from '@/dictionaries/en.json';

let allowed: boolean | null;
vi.mock('@/app/[lang]/Providers', () => ({ useDictionary: () => dict }));
vi.mock('@/src/features/designer/data/useFormTeam', { spy: true });
vi.mock('@/src/features/user-search/data/useUserSearch', () => ({
  useUserSearchAllowed: () => allowed,
}));
vi.mock('@/src/features/user-search/ui/UserSearchPicker', () => ({
  UserSearchPicker: () => <div data-testid="picker" />,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/en/build/f1',
  useSearchParams: () => new URLSearchParams(''),
}));

import FormTeamTab from '@/src/features/designer/ui/FormTeamTab';
import { clickTestId, failWrites, renderWithStore, resetTeam } from './formTeamTestKit';

const renderTab = () => renderWithStore(<FormTeamTab dict={dict} formId="f1" />);

const confirmRemoveOf = async (memberId: string) => {
  await clickTestId(`${memberId}-remove-link`);
  await screen.findByTestId('confirm-modal-message');
  await clickTestId('confirm-modal-confirm');
};

describe('FormTeamTab', () => {
  beforeEach(() => {
    allowed = true;
    resetTeam();
  });

  it('lists each member with their groups', () => {
    renderTab();
    expect(screen.getByTestId('team-list')).toHaveTextContent('Dax Halloran (sample)');
    expect(screen.getByTestId('team-list')).toHaveTextContent('dax.halloran@example.gov.bc.ca');
    expect(screen.getByTestId('user-4-group-2-tag')).toBeInTheDocument();
    expect(screen.queryByTestId('user-4-group-1-tag')).toBeNull();
  });

  it('says the team is sample data, on the list and on the form', async () => {
    renderTab();
    expect(screen.getByTestId('team-sample-notice')).toHaveTextContent('sample data');
    await clickTestId('team-add-button');
    expect(screen.getByTestId('team-sample-notice')).toBeInTheDocument();
  });

  it('opens the add form and comes back on cancel', async () => {
    renderTab();
    await clickTestId('team-add-button');
    expect(screen.getByTestId('team-member-form')).toHaveTextContent('1. Search for a user:');
    expect(screen.getByTestId('picker')).toBeInTheDocument();
    expect(screen.queryByTestId('team-list')).toBeNull();

    await clickTestId('team-cancel-button');
    expect(screen.getByTestId('team-list')).toBeInTheDocument();
  });

  it('offers no add when user search is not allowed, or until that is known', () => {
    allowed = false;
    const { unmount } = renderTab();
    expect(screen.getByTestId('team-list')).toBeInTheDocument();
    expect(screen.queryByTestId('team-add-button')).toBeNull();
    unmount();

    allowed = null;
    renderTab();
    expect(screen.queryByTestId('team-add-button')).toBeNull();
  });

  it('opens the edit form with the member and their groups', async () => {
    renderTab();
    await clickTestId('user-4-edit-link');
    const form = screen.getByTestId('team-member-form');
    expect(form).toHaveTextContent('Edit Team Member');
    expect(form).toHaveTextContent('Dax Halloran (sample)');
    expect(form).not.toHaveTextContent('1. Search for a user:');
    expect(screen.getByRole('checkbox', { name: 'Group 2' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Group 1' })).not.toBeChecked();
  });

  it('keeps the member when the remove is cancelled', async () => {
    renderTab();
    await clickTestId('user-4-remove-link');
    expect(await screen.findByTestId('confirm-modal-message')).toHaveTextContent(
      'Dax Halloran (sample) will lose access to this form.',
    );
    await clickTestId('confirm-modal-cancel');

    await waitFor(() => expect(screen.queryByTestId('confirm-modal-message')).toBeNull());
    expect(screen.getByTestId('user-4-edit-link')).toBeInTheDocument();
  });

  it('removes the member once confirmed', async () => {
    renderTab();
    await confirmRemoveOf('user-4');

    await waitFor(() => expect(screen.queryByTestId('user-4-edit-link')).toBeNull());
    expect(screen.getByTestId('user-1-edit-link')).toBeInTheDocument();
  });

  it('keeps the member when the remove fails', async () => {
    failWrites();
    renderTab();
    await confirmRemoveOf('user-4');

    await waitFor(() => expect(screen.queryByTestId('confirm-modal-message')).toBeNull());
    expect(screen.getByTestId('user-4-edit-link')).toBeInTheDocument();
  });
});
