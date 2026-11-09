import { z } from 'zod';

export const TenantSchema = z.object({
  id: z.string(),
  name: z.string(),
  ministryName: z.string(),
  description: z.string().nullish(),
  createdDateTime: z.string().nullish(),
  updatedDateTime: z.string().nullish(),
  createdBy: z.string().nullish(),
  createdByUserName: z.string().nullish(),
  createdByDisplayName: z.string().nullish(),
  updatedBy: z.string().nullish(),
});
export type Tenant = z.infer<typeof TenantSchema>;

export const ListTenantsResponseSchema = z.object({
  tenants: z.array(TenantSchema),
});
export type ListTenantsResponse = z.infer<typeof ListTenantsResponseSchema>;
