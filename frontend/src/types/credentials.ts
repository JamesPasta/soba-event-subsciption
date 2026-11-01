import type { CredentialScope } from '@soba/lib';

export type {
  CredentialFields,
  CredentialMetadata,
  CredentialScope,
  CredentialSecret,
  CredentialState,
  CredentialStatus,
  CredentialType,
} from '@soba/lib';

/** The workspace or form whose API keys a drawer shows. */
export type CredentialOwner = { kind: CredentialScope; id: string };
