import type {
  CredentialFields,
  CredentialMetadata,
  CredentialSecret,
  CredentialState,
} from '@soba/lib';
import { ConflictError, NotFoundError, ServiceUnavailableError } from '../../core/errors';
import {
  createCredentialIssuerAdapter,
  resolveDefaultCredentialIssuerCode,
} from '../../core/integrations/credential-issuer/CredentialIssuerRegistry';
import {
  CredentialRequestRejectedError,
  type CredentialIssuerAdapter,
  type IssuedApiKey,
} from '../../core/integrations/credential-issuer/CredentialIssuerAdapter';
import * as repo from '../../core/db/repos/workspaceCredentialRepo';
import { log } from '../../core/logging';
import type { CredentialListQuery } from './schema';
import { failCredentialOperation, type CredentialOperationStage } from './operationFailure';

export const credentialMetadata = (record: repo.CredentialRecord): CredentialMetadata => ({
  id: record.id,
  scope: record.formId === null ? 'workspace' : 'form',
  label: record.label,
  notes: record.notes,
  types: record.types,
  status: record.status,
  createdAt: record.createdAt.toISOString(),
  updatedAt: record.updatedAt.toISOString(),
  rotatedAt: record.rotatedAt?.toISOString() ?? null,
});

/** The issuer for `code`, or null when it is not configured or cannot generate keys. */
const usableIssuer = (code: string): CredentialIssuerAdapter | null => {
  try {
    const issuer = createCredentialIssuerAdapter(code);
    return issuer.available ? issuer : null;
  } catch {
    return null;
  }
};

const requireIssuer = (code: string): CredentialIssuerAdapter => {
  const issuer = usableIssuer(code);
  if (!issuer) throw new ServiceUnavailableError('Credential issuance is unavailable');
  return issuer;
};

const notFound = () => new NotFoundError('Credential not found');

const CONSUMER_GONE = new Set([404, 410]);

/** Rotates a key to a value nobody receives. Null when its consumer was already removed. */
const rotateAway = async (
  issuer: CredentialIssuerAdapter,
  clientId: string,
): Promise<IssuedApiKey | null> => {
  try {
    return await issuer.regenerate(clientId);
  } catch (error) {
    const gone =
      error instanceof CredentialRequestRejectedError &&
      CONSUMER_GONE.has(error.upstreamStatus ?? 0);
    if (gone) return null;
    throw error;
  }
};

export class CredentialService {
  async list(owner: repo.CredentialOwner, query: CredentialListQuery): Promise<CredentialState> {
    const { items, total } = await repo.listWorkspaceCredentials(owner, query);
    return {
      available: usableIssuer(resolveDefaultCredentialIssuerCode()) !== null,
      items: items.map(credentialMetadata),
      page: { offset: query.offset, limit: query.limit, total },
      filters: { q: query.q },
      sort: query.sort,
    };
  }

  async get(owner: repo.CredentialOwner, id: string): Promise<CredentialMetadata> {
    const record = await repo.getWorkspaceCredential(owner, id);
    if (!record) throw notFound();
    return credentialMetadata(record);
  }

  async issue(
    owner: repo.CredentialOwner,
    actorId: string,
    fields: CredentialFields,
  ): Promise<CredentialSecret> {
    const issuerCode = resolveDefaultCredentialIssuerCode();
    const issuer = requireIssuer(issuerCode);
    const record = await repo.reserveCredentialIssue(owner, issuerCode, actorId, fields);
    const done = await this.perform(record, actorId, 'issue', () =>
      issuer.issue({
        applicationName: `soba-workspace-${owner.workspaceId}-${record.id}`,
        labels: {
          'issued-by': 'soba',
          'workspace-id': owner.workspaceId,
          'credential-id': record.id,
          ...(owner.formId ? { 'form-id': owner.formId } : {}),
        },
      }),
    );
    return { credential: credentialMetadata(done.record), apiKey: done.issued.apiKey };
  }

  async update(
    owner: repo.CredentialOwner,
    id: string,
    actorId: string,
    fields: CredentialFields,
  ): Promise<CredentialMetadata> {
    const record = await repo.updateCredentialFields(owner, id, actorId, fields);
    if (!record) throw notFound();
    return credentialMetadata(record);
  }

  async regenerate(
    owner: repo.CredentialOwner,
    id: string,
    actorId: string,
  ): Promise<CredentialSecret> {
    const existing = await repo.getWorkspaceCredential(owner, id);
    if (!existing) throw notFound();
    const { record, issuer, clientId } = await this.reserve(owner, existing, actorId, 'regenerate');
    const done = await this.perform(record, actorId, 'regenerate', () =>
      issuer.regenerate(clientId),
    );
    return { credential: credentialMetadata(done.record), apiKey: done.issued.apiKey };
  }

  /** The issuer cannot revoke a key, so delete rotates it to a value nobody receives. */
  async remove(owner: repo.CredentialOwner, id: string, actorId: string): Promise<void> {
    const existing = await repo.getWorkspaceCredential(owner, id);
    if (!existing) throw notFound();
    if (existing.status === 'failed') {
      if (!(await repo.deleteFailedCredential(owner, id, actorId))) throw notFound();
      return;
    }
    const { record, issuer, clientId } = await this.reserve(owner, existing, actorId, 'delete');
    const { issued } = await this.perform(record, actorId, 'delete', () =>
      rotateAway(issuer, clientId),
    );
    if (issued === null) {
      // The consumer can also look gone after a gateway change, with the key still working there.
      log.warn(
        {
          credentialId: record.id,
          workspaceId: record.workspaceId,
          issuerCode: record.issuerCode,
          clientId,
        },
        'Credential deleted without a rotation; the gateway no longer has its consumer',
      );
    }
  }

  private async reserve(
    owner: repo.CredentialOwner,
    existing: repo.CredentialRecord,
    actorId: string,
    operation: 'regenerate' | 'delete',
  ) {
    const clientId = existing.clientId;
    if (existing.status !== 'active' || !clientId)
      throw new ConflictError('Credential operation is pending or requires reconciliation');
    const issuer = requireIssuer(existing.issuerCode);
    const record = await repo.reserveCredentialOperation(owner, existing.id, actorId, operation);
    if (!record) throw new ConflictError('Another credential operation has started');
    return { record, issuer, clientId };
  }

  private async perform<T extends IssuedApiKey | null>(
    record: repo.CredentialRecord,
    actorId: string,
    operation: repo.CredentialOperation,
    call: () => Promise<T>,
  ): Promise<{ record: repo.CredentialRecord; issued: T }> {
    let stage: CredentialOperationStage = 'upstream';
    let consumerId: string | undefined;
    try {
      const issued = await call();
      stage = 'persistence';
      consumerId = issued?.clientId;
      const saved = await repo.completeCredentialOperation(record, actorId, operation, issued);
      return { record: saved, issued };
    } catch (error) {
      return failCredentialOperation(record, actorId, operation, { stage, consumerId }, error);
    }
  }
}
export const credentialService = new CredentialService();
