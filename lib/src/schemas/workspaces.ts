import { z } from 'zod';
import { LookupMetaSchema, OffsetPageSchema, makeSortEnum } from './pagination';
import { WORKSPACE_SORT_FIELDS } from '../sort';

export const WorkspaceItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string(),
  role: z.string(),
  status: z.string(),
  org: z.string().nullable(),
  useCase: z.string().nullable(),
  disclaimerAccepted: z.boolean(),
});

export const CreateWorkspaceBodySchema = z.object({
  name: z.string().trim().min(1),
  org: z.string().trim().min(1),
  useCase: z.string().trim().min(1),
  disclaimerAccepted: z.boolean().optional(),
});

export const UpdateWorkspaceBodySchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    org: z.string().trim().min(1).optional(),
    useCase: z.string().trim().min(1).optional(),
    disclaimerAccepted: z.boolean().optional(),
  })
  .refine(
    (body) =>
      body.name !== undefined ||
      body.org !== undefined ||
      body.useCase !== undefined ||
      body.disclaimerAccepted !== undefined,
    {
      message: 'Provide a field to update',
    },
  );

export type WorkspaceItem = z.infer<typeof WorkspaceItemSchema>;
export type CreateWorkspaceBody = z.infer<typeof CreateWorkspaceBodySchema>;
export type UpdateWorkspaceBody = z.infer<typeof UpdateWorkspaceBodySchema>;

export const WorkspaceNameAvailabilityResponseSchema = z.object({
  available: z.boolean(),
});
export type WorkspaceNameAvailabilityResponse = z.infer<
  typeof WorkspaceNameAvailabilityResponseSchema
>;

export const WorkspaceSortSchema = makeSortEnum(WORKSPACE_SORT_FIELDS);

export const ListWorkspacesResponseSchema = z.object({
  items: z.array(WorkspaceItemSchema),
  page: OffsetPageSchema,
  filters: z.object({
    kind: z.string().optional(),
    status: z.string().optional(),
    q: z.string().optional(),
    requiredPermission: z.string().optional(),
  }),
  sort: WorkspaceSortSchema,
});

export type ListWorkspacesResponse = z.infer<typeof ListWorkspacesResponseSchema>;

export const WorkspaceLookupItemSchema = WorkspaceItemSchema.pick({
  id: true,
  name: true,
  kind: true,
  role: true,
  disclaimerAccepted: true,
});

export const WorkspaceLookupResponseSchema = LookupMetaSchema.extend({
  items: z.array(WorkspaceLookupItemSchema),
});

export type WorkspaceLookupItem = z.infer<typeof WorkspaceLookupItemSchema>;
export type WorkspaceLookupResponse = z.infer<typeof WorkspaceLookupResponseSchema>;

/** A workspace the caller's My Forms come from. */
export const MyWorkspaceLookupItemSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export const MyWorkspaceLookupResponseSchema = LookupMetaSchema.extend({
  items: z.array(MyWorkspaceLookupItemSchema),
});

export type MyWorkspaceLookupItem = z.infer<typeof MyWorkspaceLookupItemSchema>;
export type MyWorkspaceLookupResponse = z.infer<typeof MyWorkspaceLookupResponseSchema>;
