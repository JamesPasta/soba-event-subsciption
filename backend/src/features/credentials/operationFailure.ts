import {
  markCredentialUnknown,
  rejectCredentialOperation,
  type CredentialOperation,
  type CredentialRecord,
} from '../../core/db/repos/workspaceCredentialRepo';
import { CredentialRequestRejectedError } from '../../core/integrations/credential-issuer/CredentialIssuerAdapter';
import { ServiceUnavailableError } from '../../core/errors';
import { upstreamStatusOf } from '../../core/http/httpErrorMapper';
import { log } from '../../core/logging';

export type CredentialOperationStage = 'upstream' | 'persistence';
/** Where the operation stopped, and the consumer the issuer answered with, if it answered. */
export type CredentialOperationProgress = { stage: CredentialOperationStage; consumerId?: string };

/** Settles the reservation and exposes only a generic error to the caller. */
export async function failCredentialOperation(
  record: CredentialRecord,
  actorId: string,
  operation: CredentialOperation,
  { stage, consumerId }: CredentialOperationProgress,
  error: unknown,
): Promise<never> {
  const rejected = stage === 'upstream' && error instanceof CredentialRequestRejectedError;
  const context = {
    credentialId: record.id,
    workspaceId: record.workspaceId,
    issuerCode: record.issuerCode,
    operation,
  };
  // Allowlisted diagnostics only: errors, messages, causes and upstream bodies can hold secrets.
  log.warn(
    { ...context, stage, rejected, upstreamStatus: upstreamStatusOf(error), clientId: consumerId },
    rejected
      ? 'Credential operation refused by the issuer'
      : 'Credential operation outcome requires reconciliation',
  );
  try {
    if (rejected) await rejectCredentialOperation(record, actorId, operation);
    else await markCredentialUnknown(record, actorId, operation);
  } catch {
    // A failed recovery write leaves the existing issuing/rotating reservation in place.
    log.error(
      { ...context, stage: 'reconciliation' },
      'Could not settle credential outcome; pending reservation retained',
    );
  }
  throw new ServiceUnavailableError(
    rejected
      ? 'The credential issuer refused the request; nothing was changed.'
      : 'Credential operation did not complete. Its outcome may be unknown; an administrator must reconcile it before another attempt.',
  );
}
