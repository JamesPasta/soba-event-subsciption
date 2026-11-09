import { z } from 'zod';

/** Constructed by backend code, never forwarded directly from browser input. */
export const IssueCredentialRequestSchema = z.strictObject({
  applicationName: z.string().trim().min(1),
  applicationDescription: z.string().optional(),
  labels: z.record(z.string(), z.string()).optional(),
  aclGroups: z.array(z.string().min(1)).optional(),
});
export type IssueCredentialRequest = z.infer<typeof IssueCredentialRequestSchema>;

/** The secret is returned once to the caller; never persist or log it. */
export interface IssuedApiKey {
  clientId: string;
  apiKey: string;
  flow: 'kong-api-key-only' | 'kong-api-key-acl';
}

/** The issuer refused the request, so nothing changed upstream. Any other failure may have. */
export class CredentialRequestRejectedError extends Error {
  constructor(readonly upstreamStatus?: number) {
    super('The credential issuer refused the request');
    this.name = 'CredentialRequestRejectedError';
  }
}

export interface CredentialIssuerReadinessResult {
  ok: boolean;
  message?: string;
}

export interface CredentialIssuerAdapter {
  /** False for an issuer that cannot generate keys, such as the no-op. */
  readonly available: boolean;
  readinessCheck?(): Promise<CredentialIssuerReadinessResult>;
  issue(request: IssueCredentialRequest): Promise<IssuedApiKey>;
  regenerate(clientId: string): Promise<IssuedApiKey>;
}
