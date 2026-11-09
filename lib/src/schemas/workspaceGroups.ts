import { z } from 'zod';
import { OffsetPageSchema, makeSortEnum } from './pagination';
import { WORKSPACE_GROUP_SORT_FIELDS } from '../sort';

export const WorkspaceGroupSortSchema = makeSortEnum(WORKSPACE_GROUP_SORT_FIELDS);
export type WorkspaceGroupSort = z.infer<typeof WorkspaceGroupSortSchema>;

/** A group member: a workspace user. */
export const WorkspaceGroupMemberSchema = z.object({
  id: z.string(),
  kind: z.literal('user'),
  membershipId: z.string(),
  userId: z.string(),
  displayLabel: z.string().nullable(),
});
export type WorkspaceGroupMember = z.infer<typeof WorkspaceGroupMemberSchema>;

export const WorkspaceGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  status: z.string(),
  /** True for the two protected bootstrap groups (can't be deleted; roles can't change). */
  system: z.boolean(),
  roles: z.array(z.string()),
  members: z.array(WorkspaceGroupMemberSchema),
});
export type WorkspaceGroup = z.infer<typeof WorkspaceGroupSchema>;

export const ListWorkspaceGroupsResponseSchema = z.object({
  items: z.array(WorkspaceGroupSchema),
  page: OffsetPageSchema,
  filters: z.object({ q: z.string().optional() }),
  sort: WorkspaceGroupSortSchema,
});
export type ListWorkspaceGroupsResponse = z.infer<typeof ListWorkspaceGroupsResponseSchema>;

const RoleCodesSchema = z.array(z.string().trim().min(1)).max(20);

export const CreateWorkspaceGroupBodySchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
  roleCodes: RoleCodesSchema.default([]),
});
export type CreateWorkspaceGroupBody = z.input<typeof CreateWorkspaceGroupBodySchema>;

export const UpdateWorkspaceGroupBodySchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    description: z.string().trim().min(1).nullable().optional(),
  })
  .refine((body) => body.name !== undefined || body.description !== undefined, {
    message: 'Provide a name or description to update',
  });
export type UpdateWorkspaceGroupBody = z.infer<typeof UpdateWorkspaceGroupBodySchema>;

export const SetWorkspaceGroupRolesBodySchema = z.object({
  roleCodes: RoleCodesSchema,
});
export type SetWorkspaceGroupRolesBody = z.infer<typeof SetWorkspaceGroupRolesBodySchema>;
