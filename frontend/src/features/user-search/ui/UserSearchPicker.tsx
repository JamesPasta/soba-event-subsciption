'use client';

import { useContext, useEffect, useRef, useState } from 'react';
import {
  ComboBox,
  ComboBoxStateContext,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
  type Key,
} from 'react-aria-components';
import { Select } from '@bcgov/design-system-react-components';
import { useDictionary } from '@/app/[lang]/Providers';
import { messageForDataError } from '@/src/shared/api/dataError';
import type { Dictionary } from '@/src/types/dictionary';
import {
  USER_SEARCH_FIELDS,
  type UserSearchField,
  type UserSearchScope,
  type UserSearchUser,
} from '@/src/types/userSearch';
import {
  USER_SEARCH_MIN_LENGTH,
  useUserSearch,
  useUserSearchCapabilities,
} from '../data/useUserSearch';
import styles from './UserSearchPicker.module.css';

type UserSearchText = Dictionary['userSearch'];

const keyOf = (user: UserSearchUser): string => `${user.identityProvider}:${user.subject}`;

const nameOf = (user: UserSearchUser): string =>
  user.displayName ?? user.email ?? user.username ?? user.subject;

/** What the input shows once a person is picked: their value for the field searched. */
const inputTextOf = (user: UserSearchUser, field: UserSearchField): string =>
  user[field] ?? nameOf(user);

/** The longest term the API takes for each field. */
const MAX_LENGTH: Record<UserSearchField, number> = {
  email: 254,
  firstName: 254,
  lastName: 254,
  guid: 64,
};

/** The line under the input: the pick, a hint, progress, or what the search found. */
function statusOf(
  text: UserSearchText,
  term: string,
  selected: UserSearchUser | null,
  search: ReturnType<typeof useUserSearch>,
): string {
  // The error shows on its own; the status region stays mounted so later updates are announced.
  if (search.error) return '';
  if (selected) return text.selected.replace('{name}', nameOf(selected));
  if (term.trim().length < USER_SEARCH_MIN_LENGTH) {
    return text.hint.replace('{min}', String(USER_SEARCH_MIN_LENGTH));
  }
  if (!search.searched || search.isSearching) return text.searching;
  if (search.users.length === 0) return text.noResults;
  const found = search.truncated
    ? text.truncated.replace('{count}', String(search.users.length))
    : text.resultCount.replace('{count}', String(search.users.length));
  return search.unavailable.length > 0 ? `${found} ${text.someUnavailable}` : found;
}

/**
 * Opens the list when a new set of people arrives while the input has focus. The combo box opens
 * only as the user types, and results come after typing pauses.
 */
function OpenOnResults({ users }: Readonly<{ users: readonly UserSearchUser[] }>) {
  const state = useContext(ComboBoxStateContext);
  // Each set opens the list once, so closing it with Escape keeps it closed.
  const openedFor = useRef<readonly UserSearchUser[] | null>(null);
  useEffect(() => {
    if (!state || users === openedFor.current) return;
    openedFor.current = users;
    if (users.length > 0 && state.isFocused && !state.isOpen) state.open(null, 'manual');
  }, [state, users]);
  return null;
}

function PersonOption({
  user,
  accountType,
  text,
}: Readonly<{ user: UserSearchUser; accountType: string; text: UserSearchText }>) {
  const details = [user.email, user.username].filter(Boolean).join(' | ');
  return (
    <>
      <span className={styles.optionName}>
        {nameOf(user)}
        <span className={styles.accountType}>{accountType}</span>
        {user.sobaUserId && <span className={styles.badge}>{text.existingUser}</span>}
      </span>
      {details && <span className={styles.optionDetail}>{details}</span>}
    </>
  );
}

/**
 * Finds a person across every identity provider searchable in the scope. Picking one reports it
 * through `onSelect`; nothing is saved.
 */
export function UserSearchPicker({
  scope,
  onSelect,
}: Readonly<{
  scope: UserSearchScope;
  onSelect?: (user: UserSearchUser | null) => void;
}>) {
  const dict = useDictionary();
  const text = dict.userSearch;
  const capabilities = useUserSearchCapabilities(scope);
  const [chosenField, setChosenField] = useState<UserSearchField>('email');
  const [term, setTerm] = useState('');
  const [selected, setSelected] = useState<UserSearchUser | null>(null);

  const providers = capabilities.identityProviders;
  // A search covers the account types that accept its field.
  const fields = USER_SEARCH_FIELDS.filter((code) =>
    providers.some((provider) => provider.fields.includes(code)),
  );
  const field = fields.includes(chosenField) ? chosenField : (fields[0] ?? 'email');
  const accountTypes = new Map(providers.map(({ code, name }) => [code, name]));
  const search = useUserSearch(scope, { field, term: selected ? '' : term });

  function clearSelection() {
    setSelected(null);
    onSelect?.(null);
  }

  function restart() {
    setTerm('');
    if (selected) clearSelection();
  }

  if (capabilities.error || (capabilities.loaded && fields.length === 0)) {
    return (
      <p className="text-muted mb-0" data-testid="user-search-unavailable">
        {capabilities.error
          ? messageForDataError(capabilities.error, text.errors)
          : text.unavailable}
      </p>
    );
  }
  if (fields.length === 0) return null;

  return (
    <div>
      <div className={styles.controls}>
        {/* Sized here: a className on a BCDS field replaces its own root class. */}
        <div className={styles.select}>
          <Select
            data-testid="user-search-field"
            label={text.fieldLabel}
            items={fields.map((code) => ({ id: code, label: text.fields[code] }))}
            selectedKey={field}
            onSelectionChange={(key) => {
              setChosenField(key as UserSearchField);
              restart();
            }}
          />
        </div>
        <ComboBox
          className={styles.comboBox}
          items={search.users}
          inputValue={term}
          onInputChange={(value) => {
            setTerm(value);
            if (selected && value !== inputTextOf(selected, field)) clearSelection();
          }}
          onSelectionChange={(key: Key | null) => {
            const user = search.users.find((candidate) => keyOf(candidate) === key);
            if (!user) return;
            setSelected(user);
            setTerm(inputTextOf(user, field));
            onSelect?.(user);
          }}
          menuTrigger="input"
          allowsCustomValue
        >
          <OpenOnResults users={search.users} />
          <Label className={styles.label}>{text.inputLabel}</Label>
          <Input
            className={styles.input}
            placeholder={text.placeholder}
            maxLength={MAX_LENGTH[field]}
            data-testid="user-search-input"
          />
          <Popover className={styles.popover}>
            <ListBox<UserSearchUser> className={styles.listBox}>
              {(user) => (
                <ListBoxItem
                  id={keyOf(user)}
                  textValue={inputTextOf(user, field)}
                  className={styles.option}
                  data-testid={`user-search-option-${user.subject}`}
                >
                  <PersonOption
                    user={user}
                    accountType={accountTypes.get(user.identityProvider) ?? user.identityProvider}
                    text={text}
                  />
                </ListBoxItem>
              )}
            </ListBox>
          </Popover>
        </ComboBox>
      </div>
      {search.error && (
        <p role="alert" className="text-danger mt-2 mb-0" data-testid="user-search-error">
          {messageForDataError(search.error, text.errors)}
        </p>
      )}
      <p
        role="status"
        aria-live="polite"
        className={styles.status}
        data-testid="user-search-status"
      >
        {statusOf(text, term, selected, search)}
      </p>
    </div>
  );
}
