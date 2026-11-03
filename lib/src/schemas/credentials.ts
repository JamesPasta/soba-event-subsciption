import { z } from 'zod';
import { CREDENTIAL_SORT_FIELDS } from '../sort';
import { makeSortEnum, OffsetPageSchema } from './pagination';

/** URL segment of the API keys group at the form and workspace level, and its SWR key. */
export const API_KEY_SETTINGS_KEY = 'api-keys';

export const CredentialTypeSchema = z.enum(['api', 'web-component']);
/**
 * issuing and rotating hold an operation in progress. failed was refused by the gateway, so no key
 * exists. unknown may or may not have changed the gateway and needs an operator.
 */
export const CredentialStatusSchema = z.enum([
  'issuing',
  'active',
  'rotating',
  'failed',
  'unknown',
]);
/** workspace: the key belongs to the workspace. form: it belongs to one of its forms. */
export const CredentialScopeSchema = z.enum(['workspace', 'form']);

/** What generating a key and editing it both take. */
export const CredentialFieldsSchema = z.strictObject({
  label: z.string().trim().min(1).max(100),
  notes: z.string().trim().max(1000),
  types: z
    .array(CredentialTypeSchema)
    .min(1)
    .max(2)
    .refine((types) => new Set(types).size === types.length, 'Choose each type only once'),
});
export type CredentialFields = z.infer<typeof CredentialFieldsSchema>;
export type CredentialType = z.infer<typeof CredentialTypeSchema>;
export type CredentialStatus = z.infer<typeof CredentialStatusSchema>;
export type CredentialScope = z.infer<typeof CredentialScopeSchema>;

export const CredentialMetadataSchema = z.object({
  id: z.uuid(),
  scope: CredentialScopeSchema,
  label: z.string(),
  notes: z.string(),
  types: z.array(CredentialTypeSchema),
  status: CredentialStatusSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  rotatedAt: z.iso.datetime().nullable(),
});
export const CredentialStateSchema = z.object({
  /** Whether the configured issuer can generate keys. False under the no-op issuer. */
  available: z.boolean(),
  items: z.array(CredentialMetadataSchema),
  page: OffsetPageSchema,
  filters: z.object({ q: z.string().optional() }),
  sort: makeSortEnum(CREDENTIAL_SORT_FIELDS),
});
/** Returned once, by generate and regenerate. The key is never stored or returned again. */
export const CredentialSecretSchema = z.object({
  credential: CredentialMetadataSchema,
  apiKey: z.string(),
});
export type CredentialMetadata = z.infer<typeof CredentialMetadataSchema>;
export type CredentialState = z.infer<typeof CredentialStateSchema>;
export type CredentialSecret = z.infer<typeof CredentialSecretSchema>;
