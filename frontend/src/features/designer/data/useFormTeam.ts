'use client';

import { useMemo, useSyncExternalStore } from 'react';
import type { ListResult, WriteOutcome } from '@/src/shared/api/dataContracts';
import type { ListQueryArgs } from '@/src/types/list';
import type { TeamGroup, TeamMember } from '@/src/types/formTeam';
import type { UserSearchUser } from '@/src/types/userSearch';

// In-memory sample data until the team API exists (CCP-5928); changes last until reload.
// Shapes follow the dataContracts types; the API swap also adds the token and the groups' scope.
const GROUPS: TeamGroup[] = [
  { id: 'group-1', name: 'Group 1' },
  { id: 'group-2', name: 'Group 2' },
  { id: 'group-3', name: 'Group 3' },
  { id: 'group-4', name: 'Group 4' },
];

const sampleMember = (
  id: string,
  firstName: string,
  lastName: string,
  groups: string[],
): TeamMember => ({
  id,
  name: `${firstName} ${lastName} (sample)`,
  email: `${firstName}.${lastName}@example.gov.bc.ca`.toLowerCase(),
  groups,
});

const SAMPLE_TEAM: TeamMember[] = [
  sampleMember('user-1', 'Orla', 'Venn', ['group-1']),
  sampleMember('user-3', 'Mirela', 'Quist', ['group-1']),
  sampleMember('user-4', 'Dax', 'Halloran', ['group-2']),
  sampleMember('user-5', 'Suri', 'Okonjo', ['group-4']),
];

/** A found person's member id: their Soba user, or their identity when they have not signed in. */
const memberIdOf = (user: UserSearchUser) =>
  user.sobaUserId ?? `${user.identityProvider}:${user.subject}`;

/** Teams by form id. A form not in the map still has the sample team. */
let teams = new Map<string, TeamMember[]>();

const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const teamOf = (formId: string) => teams.get(formId) ?? SAMPLE_TEAM;
// Resolves once stored, as a real write would, so callers already wait and handle a failure.
const setTeam = (formId: string, next: TeamMember[]): Promise<WriteOutcome<void>> => {
  teams = new Map(teams).set(formId, next);
  listeners.forEach((listener) => listener());
  return Promise.resolve({ status: 'applied', value: undefined });
};
const useTeam = (formId: string) =>
  useSyncExternalStore(
    subscribe,
    () => teamOf(formId),
    () => teamOf(formId),
  );

const matches = (q: string, ...fields: string[]) =>
  fields.some((field) => field.toLowerCase().includes(q.trim().toLowerCase()));

const settled = <T>(rows: T[], total: number): ListResult<T> => ({
  rows,
  total,
  isLoading: false,
  isRefreshing: false,
  error: null,
  refresh: () => Promise.resolve(),
});

/** One page of the form's team members, by name. */
export function useFormTeamMembers(formId: string, query: ListQueryArgs): ListResult<TeamMember> {
  const team = useTeam(formId);
  const { q = '', offset, limit } = query;
  return useMemo(() => {
    const found = team
      .filter((member) => matches(q, member.name, member.email))
      .sort((a, b) => a.name.localeCompare(b.name));
    return settled(found.slice(offset, offset + limit), found.length);
  }, [team, q, offset, limit]);
}

/** The groups a team member can be assigned to. */
export function useTeamGroups(): TeamGroup[] {
  return GROUPS;
}

export function useFormTeamWriter(formId: string) {
  return useMemo(
    () => ({
      /** Refused for a user already on the team, as the API will be: their groups change by Edit. */
      add: (user: UserSearchUser, groups: string[]) => {
        const team = teamOf(formId);
        const id = memberIdOf(user);
        if (team.some((member) => member.id === id)) {
          return Promise.reject(new Error(`${id} is already on the team`));
        }
        const name = user.displayName ?? user.email ?? user.username ?? user.subject;
        return setTeam(formId, [...team, { id, name, email: user.email ?? '', groups }]);
      },
      setGroups: (memberId: string, groups: string[]) =>
        setTeam(
          formId,
          teamOf(formId).map((member) => (member.id === memberId ? { ...member, groups } : member)),
        ),
      remove: (memberId: string) =>
        setTeam(
          formId,
          teamOf(formId).filter((member) => member.id !== memberId),
        ),
    }),
    [formId],
  );
}

/** Puts every form back to the sample team. For tests. */
export const resetFormTeam = () => {
  teams = new Map();
  listeners.forEach((listener) => listener());
};
