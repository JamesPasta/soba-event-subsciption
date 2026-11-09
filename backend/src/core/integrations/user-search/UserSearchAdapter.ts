import type { UserSearchField } from '@soba/lib';

export interface UserSearchReadinessResult {
  ok: boolean;
  message?: string;
}

/** An identity provider this adapter can search, and the filters it accepts for it. */
export interface UserSearchCapability {
  /** soba.identity_provider code, e.g. 'azureidir'. */
  identityProvider: string;
  fields: readonly UserSearchField[];
}

export interface UserSearchRequest {
  identityProvider: string;
  /** Every filter here is one the capability for identityProvider accepts. */
  filters: Partial<Record<UserSearchField, string>>;
  /** Most hits to return; more than this sets truncated. */
  limit: number;
}

/** A person as one adapter knows them. identityProvider and subject are the user_identity key. */
export interface UserSearchHit {
  identityProvider: string;
  subject: string;
  guid: string | null;
  username: string | null;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
}

export interface UserSearchAdapterResult {
  hits: UserSearchHit[];
  truncated: boolean;
}

/**
 * A source of people to search. search throws ValidationError when the source refuses the
 * filters or the identity provider, and ServiceUnavailableError when it cannot answer.
 */
export interface UserSearchAdapter {
  capabilities(): Promise<readonly UserSearchCapability[]>;
  search(request: UserSearchRequest): Promise<UserSearchAdapterResult>;
  readinessCheck?(): Promise<UserSearchReadinessResult>;
}
