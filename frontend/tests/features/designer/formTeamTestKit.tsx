import React, { act } from 'react';
import { vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';

import makeStore from '@/lib/store';
import { resetFormTeam, useFormTeamWriter } from '@/src/features/designer/data/useFormTeam';
import type { UserSearchUser } from '@/src/types/userSearch';

/** Access tab test helpers. Tests mock the data module with `{ spy: true }` so a write can fail. */
export const renderWithStore = (ui: React.ReactElement) =>
  render(<Provider store={makeStore()}>{ui}</Provider>);

/** Clicks, then waits for the updates and promises the click set off. */
export const click = (element: HTMLElement) =>
  act(() => {
    fireEvent.click(element);
    return Promise.resolve();
  });

export const clickTestId = (testId: string) => click(screen.getByTestId(testId));

/** Puts the sample team and the real writer back. Call before each test. */
export const resetTeam = () => {
  vi.mocked(useFormTeamWriter).mockReset();
  act(() => resetFormTeam());
};

/** A person user search found. A sample member's id as `sobaUserId` puts them on the team. */
export const foundPerson = (
  subject: string,
  displayName: string,
  sobaUserId: string | null = null,
): UserSearchUser => ({
  identityProvider: 'azureidir',
  subject,
  guid: null,
  username: null,
  displayName,
  firstName: null,
  lastName: null,
  email: `${subject}@example.gov.bc.ca`,
  sobaUserId,
  sources: ['user-search-soba'],
});

/** The sample writer cannot fail, so a failed save is forced. */
export const failWrites = () => {
  const refuse = () => Promise.reject(new Error('refused'));
  vi.mocked(useFormTeamWriter).mockReturnValue({ add: refuse, setGroups: refuse, remove: refuse });
};
