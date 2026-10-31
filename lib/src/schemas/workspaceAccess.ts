import { z } from 'zod';
import { OffsetPageSchema, makeSortEnum } from './pagination';
import { WORKSPACE_ACCESS_SORT_FIELDS } from '../sort';

export const WorkspaceAccessSortSchema = makeSortEnum(WORKSPACE_ACCESS_SORT_FIELDS);
export type WorkspaceAccessSort = z.infer<typeof WorkspaceAccessSortSchema>;

/** Who the access list holds: members in at least one group, or every active member. */
export const WORKSPACE_ACCESS_INCLUDE = ['grouped', 'all'] as const;
export const WorkspaceAccessIncludeSchema = z.enum(WORKSPACE_ACCESS_INCLUDE);
export type WorkspaceAccessInclude = z.infer<typeof WorkspaceAccessIncludeSchema>;

export const WorkspaceAccessGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type WorkspaceAccessGroup = z.infer<typeof WorkspaceAccessGroupSchema>;

/** An active workspace member and the workspace groups they are in. */
export const WorkspaceAccessMemberSchema = z.object({
  membershipId: z.string(),
  userId: z.string(),
  displayLabel: z.string().nullable(),
  email: z.string().nullable(),
  /** The workspace membership role: owner, admin, member or viewer. */
  role: z.string(),
  groups: z.array(WorkspaceAccessGroupSchema),
});
export type WorkspaceAccessMember = z.infer<typeof WorkspaceAccessMemberSchema>;

export const ListWorkspaceAccessResponseSchema = z.object({
  items: z.array(WorkspaceAccessMemberSchema),
  page: OffsetPageSchema,
  filters: z.object({ q: z.string().optional(), include: WorkspaceAccessIncludeSchema }),
  sort: WorkspaceAccessSortSchema,
});
export type ListWorkspaceAccessResponse = z.infer<typeof ListWorkspaceAccessResponseSchema>;

const GroupIdsSchema = z.array(z.uuid().toLowerCase()).min(1).max(500);

export const AddWorkspaceAccessBodySchema = z.object({
  userId: z.uuid().toLowerCase(),
  groupIds: GroupIdsSchema,
});
export type AddWorkspaceAccessBody = z.infer<typeof AddWorkspaceAccessBodySchema>;

export const SetWorkspaceAccessGroupsBodySchema = z.object({
  groupIds: GroupIdsSchema,
});
export type SetWorkspaceAccessGroupsBody = z.infer<typeof SetWorkspaceAccessGroupsBodySchema>;
