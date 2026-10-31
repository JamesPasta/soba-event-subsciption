import type {
  ListWorkspaceAccessResponse,
  WorkspaceAccessMember,
} from '@/src/types/workspaceAccess';
import type { UserSearchUser } from '@/src/types/userSearch';
import { ADMINS, REVIEWERS } from './workspaceGroupsTestKit';

/** The signed-in user in these tests. */
export const SELF_USER_ID = 'u-self';

export const member = (
  overrides: Partial<WorkspaceAccessMember> & { membershipId: string },
): WorkspaceAccessMember => ({
  userId: `user-${overrides.membershipId}`,
  displayLabel: overrides.membershipId,
  email: null,
  role: 'viewer',
  groups: [],
  ...overrides,
});

export const OWNER = member({
  membershipId: 'm-owner',
  displayLabel: 'Olive Owner',
  email: 'olive@example.gov.bc.ca',
  role: 'owner',
  groups: [{ id: ADMINS.id, name: ADMINS.name }],
});

export const SELF = member({
  membershipId: 'm-self',
  userId: SELF_USER_ID,
  displayLabel: 'Sam Self',
  role: 'admin',
  groups: [{ id: ADMINS.id, name: ADMINS.name }],
});

export const REVIEWER = member({
  membershipId: 'm-reviewer',
  displayLabel: 'Rita Reviewer',
  email: 'rita@example.gov.bc.ca',
  groups: [{ id: REVIEWERS.id, name: REVIEWERS.name }],
});

/** A server page of `items`, as the list endpoint answers. */
export const accessPage = (
  items: WorkspaceAccessMember[],
  page: { offset?: number; limit?: number; total?: number } = {},
): ListWorkspaceAccessResponse => ({
  items,
  page: { offset: page.offset ?? 0, limit: page.limit ?? 10, total: page.total ?? items.length },
  filters: { include: 'grouped' },
  sort: 'displayLabel:asc',
});

export const foundPerson = (overrides: Partial<UserSearchUser> = {}): UserSearchUser => ({
  identityProvider: 'idir',
  subject: 'found@idir',
  guid: 'FOUNDGUID',
  username: 'found',
  displayName: 'Fran Found',
  firstName: 'Fran',
  lastName: 'Found',
  email: 'fran@example.gov.bc.ca',
  sobaUserId: 'user-found',
  sources: ['user-search-soba'],
  ...overrides,
});
