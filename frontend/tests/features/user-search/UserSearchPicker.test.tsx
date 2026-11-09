import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserSearchIdentityProvider, UserSearchUser } from '@/src/types/userSearch';
import type { DataError } from '@/src/shared/api/dataContracts';

vi.mock('@/app/[lang]/Providers', async () => {
  const dict = { ...(await import('@/dictionaries/en.json')).default, locale: 'en' };
  return { useDictionary: () => dict };
});

type SearchState = {
  users: UserSearchUser[];
  truncated: boolean;
  unavailable: string[];
  searched: boolean;
  isSearching: boolean;
  error: DataError | null;
};

const idir: UserSearchIdentityProvider = {
  code: 'azureidir',
  name: 'IDIR - MFA',
  fields: ['email', 'firstName', 'lastName', 'guid'],
};
const bceid: UserSearchIdentityProvider = {
  code: 'bceidbusiness',
  name: 'BCeID Business',
  fields: ['guid'],
};
let providers: UserSearchIdentityProvider[];
let found: SearchState;
const useUserSearch = vi.fn();

vi.mock('@/src/features/user-search/data/useUserSearch', () => ({
  USER_SEARCH_MIN_LENGTH: 2,
  useUserSearchCapabilities: () => ({
    identityProviders: providers,
    loaded: true,
    isLoading: false,
    error: null,
  }),
  // A term below the minimum is never searched, as in the real hook. While `pending`, the
  // answer has not arrived yet.
  useUserSearch: (...args: [unknown, { field: string; term: string }]) => {
    useUserSearch(...args);
    const empty = { ...found, users: [], searched: false };
    return args[1].term.trim().length >= 2 && !pending ? found : empty;
  },
}));
let pending = false;

import { UserSearchPicker } from '@/src/features/user-search/ui/UserSearchPicker';

const alice: UserSearchUser = {
  identityProvider: 'azureidir',
  subject: 'f0e1d2c3@azureidir',
  guid: 'F0E1D2C3',
  username: 'ASMITH',
  displayName: 'Smith, Alice CITZ:EX',
  firstName: 'Alice',
  lastName: 'Smith',
  email: 'alice@example.com',
  sobaUserId: 'user-a',
  sources: ['css-v1', 'user-search-soba'],
};
const bob: UserSearchUser = {
  ...alice,
  subject: 'a9b8c7d6@azureidir',
  displayName: 'Smith, Bob CITZ:EX',
  firstName: 'Bob',
  email: 'bob@example.com',
  username: 'BSMITH',
  sobaUserId: null,
  sources: ['css-v1'],
};

const scope = { kind: 'form' as const, id: 'form-1' };
const lastInput = () => useUserSearch.mock.calls.at(-1)?.[1];
const input = () => screen.getByRole('combobox', { name: 'Person' });

describe('UserSearchPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pending = false;
    providers = [idir];
    found = {
      users: [alice, bob],
      truncated: false,
      unavailable: [],
      searched: true,
      isSearching: false,
      error: null,
    };
  });

  it('asks for a longer term until there is one', () => {
    render(<UserSearchPicker scope={scope} />);
    expect(screen.getByTestId('user-search-status')).toHaveTextContent(
      'Type at least 2 characters.',
    );
  });

  it('lists the people found and says how many', async () => {
    const user = userEvent.setup();
    render(<UserSearchPicker scope={scope} />);

    await user.type(input(), 'smi');

    expect(lastInput()).toEqual({ field: 'email', term: 'smi' });
    const options = await screen.findAllByRole('option');
    expect(options).toHaveLength(2);
    expect(within(options[0]).getByText('Smith, Alice CITZ:EX')).toBeInTheDocument();
    expect(within(options[0]).getByText('IDIR - MFA')).toBeInTheDocument();
    expect(within(options[0]).getByText('Existing user')).toBeInTheDocument();
    expect(within(options[0]).getByText('alice@example.com | ASMITH')).toBeInTheDocument();
    expect(within(options[1]).queryByText('Existing user')).not.toBeInTheDocument();
    expect(screen.getByTestId('user-search-status')).toHaveTextContent('2 found.');
  });

  it('opens the list when the people arrive after typing stops', async () => {
    pending = true;
    const user = userEvent.setup();
    const { rerender } = render(<UserSearchPicker scope={scope} />);

    await user.type(input(), 'smi');
    expect(screen.queryAllByRole('option')).toHaveLength(0);

    pending = false;
    rerender(<UserSearchPicker scope={scope} />);

    expect(await screen.findAllByRole('option')).toHaveLength(2);
  });

  it('says when the list was cut off or a directory could not answer', async () => {
    found = { ...found, truncated: true, unavailable: ['css-v1'] };
    const user = userEvent.setup();
    render(<UserSearchPicker scope={scope} />);

    await user.type(input(), 'smi');

    expect(screen.getByTestId('user-search-status')).toHaveTextContent(
      'Showing the first 2. Refine your search. Some directories could not be searched',
    );
  });

  it('reports a pick, shows the searched value, and searches anew once the text is edited', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<UserSearchPicker scope={scope} onSelect={onSelect} />);

    await user.type(input(), 'smi');
    await user.click(await screen.findByTestId('user-search-option-f0e1d2c3@azureidir'));

    expect(onSelect).toHaveBeenLastCalledWith(alice);
    expect(input()).toHaveValue('alice@example.com');
    expect(screen.getByTestId('user-search-status')).toHaveTextContent(
      'Selected: Smith, Alice CITZ:EX',
    );
    expect(lastInput()?.term).toBe('');

    await user.type(input(), '{Backspace}');

    expect(onSelect).toHaveBeenLastCalledWith(null);
    expect(lastInput()?.term).toBe('alice@example.co');
  });

  it('says while a search is pending, even with people already listed', async () => {
    found = { ...found, isSearching: true };
    const user = userEvent.setup();
    render(<UserSearchPicker scope={scope} />);

    await user.type(input(), 'smi');

    expect(screen.getByTestId('user-search-status')).toHaveTextContent('Searching...');
  });

  it('shows the search error and empties the status', async () => {
    found = { ...found, users: [], error: { kind: 'forbidden', cause: new Error('403') } };
    const user = userEvent.setup();
    render(<UserSearchPicker scope={scope} />);

    await user.type(input(), 'smi');

    expect(screen.getByRole('alert')).toHaveTextContent(
      'You do not have permission to search for people here.',
    );
    expect(screen.getByTestId('user-search-status')).toBeEmptyDOMElement();
  });

  it('labels each person with their account type, with no account type to choose', async () => {
    const carol: UserSearchUser = {
      ...bob,
      identityProvider: 'bceidbusiness',
      subject: 'c1@bceidbusiness',
      displayName: 'Carol Smith',
    };
    providers = [bceid, idir];
    found = { ...found, users: [alice, carol] };
    const user = userEvent.setup();
    render(<UserSearchPicker scope={scope} />);

    await user.type(input(), 'smi');

    const options = await screen.findAllByRole('option');
    expect(within(options[0]).getByText('IDIR - MFA')).toBeInTheDocument();
    expect(within(options[1]).getByText('BCeID Business')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.getAllByRole('button')).toEqual([
      screen.getByRole('button', { name: /Search by/ }),
    ]);
  });

  it('offers every field some account type takes, and starts over on another field', async () => {
    providers = [
      { ...idir, fields: ['email'] },
      { ...bceid, fields: ['guid'] },
    ];
    const user = userEvent.setup();
    render(<UserSearchPicker scope={scope} />);
    await user.type(input(), 'smi');
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: /Search by/ }));
    expect(screen.queryByRole('option', { name: 'First name' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: 'GUID' }));

    await waitFor(() => expect(lastInput()).toEqual({ field: 'guid', term: '' }));
    expect(input()).toHaveValue('');
    expect(input()).toHaveAttribute('maxlength', '64');
  });

  it('says search is unavailable when nothing can be searched', () => {
    providers = [];
    render(<UserSearchPicker scope={scope} />);

    expect(screen.getByTestId('user-search-unavailable')).toHaveTextContent(
      'User search is unavailable.',
    );
  });
});
