import { z } from 'zod';

export const USER_SEARCH_FIELDS = ['email', 'firstName', 'lastName', 'guid'] as const;
export const UserSearchFieldSchema = z.enum(USER_SEARCH_FIELDS);
export type UserSearchField = z.infer<typeof UserSearchFieldSchema>;

const textFilter = z.string().trim().min(2).max(254);

/**
 * One search; every filter given must match. Without identityProvider, every identity provider
 * searchable here is searched.
 */
export const UserSearchQuerySchema = z
  .object({
    identityProvider: z.string().trim().min(1).max(64).optional(),
    email: textFilter.optional(),
    firstName: textFilter.optional(),
    lastName: textFilter.optional(),
    guid: z.string().trim().min(2).max(64).optional(),
  })
  .strict()
  .refine((query) => USER_SEARCH_FIELDS.some((field) => query[field]), {
    message: 'Provide at least one search field',
  });
export type UserSearchQuery = z.infer<typeof UserSearchQuerySchema>;

/** A person one or more plugins found. identityProvider and subject are the user_identity key. */
export const UserSearchUserSchema = z.object({
  identityProvider: z.string(),
  subject: z.string(),
  guid: z.string().nullable(),
  username: z.string().nullable(),
  displayName: z.string().nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  email: z.string().nullable(),
  /** The Soba user holding this identity, or null when it has none yet. */
  sobaUserId: z.string().nullable(),
  /** Codes of the plugins that returned this person. */
  sources: z.array(z.string()),
});
export type UserSearchUser = z.infer<typeof UserSearchUserSchema>;

export const USER_SEARCH_PLUGIN_OUTCOMES = ['ok', 'rejected', 'unavailable'] as const;
export type UserSearchPluginOutcome = (typeof USER_SEARCH_PLUGIN_OUTCOMES)[number];

export const UserSearchPluginStatusSchema = z.object({
  code: z.string(),
  status: z.enum(USER_SEARCH_PLUGIN_OUTCOMES),
  truncated: z.boolean(),
});
export type UserSearchPluginStatus = z.infer<typeof UserSearchPluginStatusSchema>;

export const UserSearchResponseSchema = z.object({
  users: z.array(UserSearchUserSchema),
  truncated: z.boolean(),
  plugins: z.array(UserSearchPluginStatusSchema),
});
export type UserSearchResponse = z.infer<typeof UserSearchResponseSchema>;

/** An identity provider the caller can search here, and the filters it accepts. */
export const UserSearchIdentityProviderSchema = z.object({
  code: z.string(),
  name: z.string(),
  fields: z.array(UserSearchFieldSchema),
});
export type UserSearchIdentityProvider = z.infer<typeof UserSearchIdentityProviderSchema>;

/**
 * A person found by user search, to make a Soba user for. Only the identity provider and guid are
 * taken; the stored details come from asking the directory again.
 */
export const CreateUserFromSearchBodySchema = z
  .object({
    identityProvider: z.string().trim().min(1).max(64),
    guid: z.string().trim().min(2).max(64),
  })
  .strict();
export type CreateUserFromSearchBody = z.infer<typeof CreateUserFromSearchBodySchema>;

/** The Soba user for the person; `created` is false when one already existed. */
export const CreateUserFromSearchResponseSchema = z.object({
  userId: z.string(),
  created: z.boolean(),
});
export type CreateUserFromSearchResponse = z.infer<typeof CreateUserFromSearchResponseSchema>;

export const UserSearchCapabilitiesResponseSchema = z.object({
  identityProviders: z.array(UserSearchIdentityProviderSchema),
});
export type UserSearchCapabilitiesResponse = z.infer<typeof UserSearchCapabilitiesResponseSchema>;
