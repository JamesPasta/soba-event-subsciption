jest.mock('../../../src/core/logging', () => ({ log: { warn: jest.fn(), error: jest.fn() } }));
import { log } from '../../../src/core/logging';
jest.mock('../../../src/core/db/repos/workspaceCredentialRepo', () => ({
  getWorkspaceCredential: jest.fn(),
  listWorkspaceCredentials: jest.fn(),
  reserveCredentialIssue: jest.fn(),
  reserveCredentialOperation: jest.fn(),
  completeCredentialOperation: jest.fn(),
  rejectCredentialOperation: jest.fn(),
  markCredentialUnknown: jest.fn(),
  updateCredentialFields: jest.fn(),
  deleteFailedCredential: jest.fn(),
}));
jest.mock('../../../src/core/integrations/credential-issuer/CredentialIssuerRegistry', () => ({
  createCredentialIssuerAdapter: jest.fn(),
  resolveDefaultCredentialIssuerCode: jest.fn(),
}));
import { CredentialService } from '../../../src/features/credentials/service';
import * as repo from '../../../src/core/db/repos/workspaceCredentialRepo';
import * as registry from '../../../src/core/integrations/credential-issuer/CredentialIssuerRegistry';
import { CredentialRequestRejectedError } from '../../../src/core/integrations/credential-issuer/CredentialIssuerAdapter';
import { ConflictError, NotFoundError, ServiceUnavailableError } from '../../../src/core/errors';

const mockedRepo = jest.mocked(repo);
const mockedRegistry = jest.mocked(registry);
const service = new CredentialService();
const query = { offset: 0, limit: 20, sort: 'createdAt:desc' as const, locale: 'en' as const };
const workspaceOwner = { workspaceId: 'workspace', formId: null };
const formOwner = { workspaceId: 'workspace', formId: 'form' };
const fields = { label: 'Integration', notes: '', types: ['api', 'web-component'] as const };
const issued = {
  clientId: 'consumer',
  apiKey: 'never-store-this',
  flow: 'kong-api-key-only' as const,
};
const record: repo.CredentialRecord = {
  id: 'credential',
  workspaceId: 'workspace',
  formId: null,
  issuerCode: 'original-issuer',
  clientId: null,
  flow: null,
  label: 'Integration',
  types: ['api', 'web-component'],
  notes: '',
  status: 'issuing',
  createdBy: 'actor',
  updatedBy: 'actor',
  createdAt: new Date('2026-10-31T00:00:00Z'),
  updatedAt: new Date('2026-10-31T00:00:00Z'),
  rotatedAt: null,
  deletedAt: null,
  deletedBy: null,
};
const active: repo.CredentialRecord = { ...record, status: 'active', clientId: issued.clientId };
const adapter = { available: true, issue: jest.fn(), regenerate: jest.fn() };

beforeEach(() => {
  jest.resetAllMocks();
  adapter.available = true;
  mockedRegistry.resolveDefaultCredentialIssuerCode.mockReturnValue('new-default');
  mockedRegistry.createCredentialIssuerAdapter.mockReturnValue(adapter);
  mockedRepo.reserveCredentialIssue.mockResolvedValue(record);
  mockedRepo.completeCredentialOperation.mockResolvedValue(active);
  mockedRepo.getWorkspaceCredential.mockResolvedValue(active);
  mockedRepo.reserveCredentialOperation.mockResolvedValue({ ...active, status: 'rotating' });
  adapter.issue.mockResolvedValue(issued);
  adapter.regenerate.mockResolvedValue(issued);
});

describe('credential service', () => {
  it('reserves before issuing, sends trusted labels, and returns the key once', async () => {
    const result = await service.issue(formOwner, 'actor', { ...fields, types: [...fields.types] });
    expect(mockedRepo.reserveCredentialIssue).toHaveBeenCalledWith(
      formOwner,
      'new-default',
      'actor',
      { ...fields, types: [...fields.types] },
    );
    expect(adapter.issue).toHaveBeenCalledWith({
      applicationName: 'soba-workspace-workspace-credential',
      labels: {
        'issued-by': 'soba',
        'workspace-id': 'workspace',
        'credential-id': 'credential',
        'form-id': 'form',
      },
    });
    expect(mockedRepo.completeCredentialOperation).toHaveBeenCalledWith(
      record,
      'actor',
      'issue',
      issued,
    );
    expect(result.apiKey).toBe('never-store-this');
    expect(JSON.stringify(result.credential)).not.toContain('consumer');
  });

  it('reserves nothing when the issuer cannot generate keys', async () => {
    adapter.available = false;
    await expect(
      service.issue(workspaceOwner, 'actor', { ...fields, types: ['api'] }),
    ).rejects.toBeInstanceOf(ServiceUnavailableError);
    expect(mockedRepo.reserveCredentialIssue).not.toHaveBeenCalled();
  });

  it('records a refused issue as failed, not unknown', async () => {
    adapter.issue.mockRejectedValue(new CredentialRequestRejectedError(403));
    await expect(
      service.issue(workspaceOwner, 'actor', { ...fields, types: ['api'] }),
    ).rejects.toThrow(/refused the request; nothing was changed/);
    expect(mockedRepo.rejectCredentialOperation).toHaveBeenCalledWith(record, 'actor', 'issue');
    expect(mockedRepo.markCredentialUnknown).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ rejected: true, upstreamStatus: 403, stage: 'upstream' }),
      expect.any(String),
    );
  });

  it.each([
    ['an upstream timeout', 'upstream'],
    ['a lost completion write', 'persistence'],
  ])('leaves the outcome unknown after %s', async (_name, stage) => {
    const secretError = new Error(`secret-bearing ${issued.apiKey}`);
    if (stage === 'upstream') adapter.issue.mockRejectedValue(secretError);
    else mockedRepo.completeCredentialOperation.mockRejectedValue(secretError);
    await expect(
      service.issue(workspaceOwner, 'actor', { ...fields, types: ['api'] }),
    ).rejects.toThrow(/outcome may be unknown/);
    expect(mockedRepo.markCredentialUnknown).toHaveBeenCalledWith(record, 'actor', 'issue');
    expect(mockedRepo.rejectCredentialOperation).not.toHaveBeenCalled();
    expect(JSON.stringify(jest.mocked(log.warn).mock.calls)).not.toContain(issued.apiKey);
  });

  it('treats a refusal reported while saving the result as unknown', async () => {
    mockedRepo.completeCredentialOperation.mockRejectedValue(new CredentialRequestRejectedError());
    await expect(
      service.issue(workspaceOwner, 'actor', { ...fields, types: ['api'] }),
    ).rejects.toThrow(/outcome may be unknown/);
    expect(mockedRepo.markCredentialUnknown).toHaveBeenCalled();
  });

  it("regenerates with the key's own issuer and consumer, not the current default", async () => {
    const result = await service.regenerate(workspaceOwner, 'credential', 'actor');
    expect(mockedRegistry.createCredentialIssuerAdapter).toHaveBeenCalledWith('original-issuer');
    expect(mockedRepo.reserveCredentialOperation).toHaveBeenCalledWith(
      workspaceOwner,
      'credential',
      'actor',
      'regenerate',
    );
    expect(adapter.regenerate).toHaveBeenCalledWith('consumer');
    expect(result.apiKey).toBe('never-store-this');
  });

  it('puts a refused regeneration back to active', async () => {
    adapter.regenerate.mockRejectedValue(new CredentialRequestRejectedError(400));
    await expect(service.regenerate(workspaceOwner, 'credential', 'actor')).rejects.toThrow(
      ServiceUnavailableError,
    );
    expect(mockedRepo.rejectCredentialOperation).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'rotating' }),
      'actor',
      'regenerate',
    );
  });

  it.each(['issuing', 'rotating', 'unknown', 'failed'] as const)(
    'refuses to regenerate a %s key',
    async (status) => {
      mockedRepo.getWorkspaceCredential.mockResolvedValue({ ...active, status });
      await expect(service.regenerate(workspaceOwner, 'credential', 'actor')).rejects.toThrow(
        ConflictError,
      );
      expect(mockedRepo.reserveCredentialOperation).not.toHaveBeenCalled();
    },
  );

  it('refuses a concurrent operation, and 404s a key the owner does not hold', async () => {
    mockedRepo.reserveCredentialOperation.mockResolvedValue(null);
    await expect(service.regenerate(workspaceOwner, 'credential', 'actor')).rejects.toThrow(
      ConflictError,
    );
    mockedRepo.getWorkspaceCredential.mockResolvedValue(null);
    await expect(service.remove(formOwner, 'credential', 'actor')).rejects.toThrow(NotFoundError);
    expect(adapter.regenerate).not.toHaveBeenCalled();
  });

  it('deletes an active key by rotating it to a value nobody receives', async () => {
    await expect(service.remove(workspaceOwner, 'credential', 'actor')).resolves.toBeUndefined();
    expect(mockedRepo.reserveCredentialOperation).toHaveBeenCalledWith(
      workspaceOwner,
      'credential',
      'actor',
      'delete',
    );
    expect(adapter.regenerate).toHaveBeenCalledWith('consumer');
    expect(mockedRepo.completeCredentialOperation).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'rotating' }),
      'actor',
      'delete',
      issued,
    );
  });

  it.each([404, 410])(
    'deletes a key whose consumer the gateway no longer has (%s)',
    async (upstreamStatus) => {
      adapter.regenerate.mockRejectedValue(new CredentialRequestRejectedError(upstreamStatus));
      await service.remove(workspaceOwner, 'credential', 'actor');
      expect(mockedRepo.completeCredentialOperation).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'rotating' }),
        'actor',
        'delete',
        null,
      );
      expect(mockedRepo.rejectCredentialOperation).not.toHaveBeenCalled();
      expect(log.warn).toHaveBeenCalledWith(
        expect.objectContaining({ credentialId: 'credential', clientId: 'consumer' }),
        expect.any(String),
      );
    },
  );

  it.each([
    ['a refusal', 403],
    ['a token failure, which has no status', undefined],
  ])('keeps a key whose delete met %s, still working', async (_name, upstreamStatus) => {
    adapter.regenerate.mockRejectedValue(new CredentialRequestRejectedError(upstreamStatus));
    await expect(service.remove(workspaceOwner, 'credential', 'actor')).rejects.toThrow(
      ServiceUnavailableError,
    );
    expect(mockedRepo.rejectCredentialOperation).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'rotating' }),
      'actor',
      'delete',
    );
    expect(mockedRepo.completeCredentialOperation).not.toHaveBeenCalled();
  });

  it('404s a failed-key delete that another request settled first', async () => {
    mockedRepo.getWorkspaceCredential.mockResolvedValue({ ...record, status: 'failed' });
    mockedRepo.deleteFailedCredential.mockResolvedValue(false);
    await expect(service.remove(formOwner, 'credential', 'actor')).rejects.toThrow(NotFoundError);
  });

  it('reserves nothing to regenerate while the issuer is unusable', async () => {
    adapter.available = false;
    await expect(service.regenerate(workspaceOwner, 'credential', 'actor')).rejects.toThrow(
      ServiceUnavailableError,
    );
    expect(mockedRepo.reserveCredentialOperation).not.toHaveBeenCalled();
  });

  it('logs the consumer id, never the key, when saving the result fails', async () => {
    mockedRepo.completeCredentialOperation.mockRejectedValue(new Error('lost connection'));
    await expect(
      service.issue(workspaceOwner, 'actor', { ...fields, types: ['api'] }),
    ).rejects.toThrow(/outcome may be unknown/);
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'persistence', clientId: 'consumer' }),
      expect.any(String),
    );
    expect(JSON.stringify(jest.mocked(log.warn).mock.calls)).not.toContain(issued.apiKey);
  });

  it('deletes a failed key without calling the issuer', async () => {
    mockedRepo.getWorkspaceCredential.mockResolvedValue({ ...record, status: 'failed' });
    mockedRepo.deleteFailedCredential.mockResolvedValue(true);
    await service.remove(formOwner, 'credential', 'actor');
    expect(mockedRepo.deleteFailedCredential).toHaveBeenCalledWith(
      formOwner,
      'credential',
      'actor',
    );
    expect(mockedRegistry.createCredentialIssuerAdapter).not.toHaveBeenCalled();
  });

  it('refuses to delete a key whose outcome is unknown', async () => {
    mockedRepo.getWorkspaceCredential.mockResolvedValue({ ...record, status: 'unknown' });
    await expect(service.remove(workspaceOwner, 'credential', 'actor')).rejects.toThrow(
      ConflictError,
    );
    expect(mockedRepo.deleteFailedCredential).not.toHaveBeenCalled();
  });

  it('saves fields without calling the issuer, and 404s a key the owner does not hold', async () => {
    mockedRepo.updateCredentialFields.mockResolvedValue({ ...active, label: 'Renamed' });
    const saved = await service.update(formOwner, 'credential', 'actor', {
      label: 'Renamed',
      notes: 'Vault',
      types: ['api'],
    });
    expect(saved.label).toBe('Renamed');
    expect(adapter.issue).not.toHaveBeenCalled();
    mockedRepo.updateCredentialFields.mockResolvedValue(null);
    await expect(
      service.update(formOwner, 'other', 'actor', { label: 'x', notes: '', types: ['api'] }),
    ).rejects.toThrow(NotFoundError);
  });

  it("lists metadata with each key's scope, and reports an unusable issuer as unavailable", async () => {
    mockedRepo.listWorkspaceCredentials.mockResolvedValue({
      items: [active, { ...active, id: 'form-key', formId: 'form' }],
      total: 2,
    });
    const listed = await service.list(formOwner, query);
    expect(listed.available).toBe(true);
    expect(listed.items.map((item) => [item.id, item.scope])).toEqual([
      ['credential', 'workspace'],
      ['form-key', 'form'],
    ]);
    expect(JSON.stringify(listed)).not.toContain('consumer');

    adapter.available = false;
    expect((await service.list(formOwner, query)).available).toBe(false);
    mockedRegistry.createCredentialIssuerAdapter.mockImplementation(() => {
      throw new Error('PLUGIN_APS_CREDENTIAL_ISSUER_V3_CLIENT_SECRET is required');
    });
    expect((await service.list(formOwner, query)).available).toBe(false);
  });
});
