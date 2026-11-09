jest.mock('../../../src/core/db/client', () => ({ db: {} }));

jest.mock('../../../src/core/db/repos/submissionRepo', () => ({
  getSubmissionRecordById: jest.fn(),
}));
jest.mock('../../../src/core/db/repos/submitterSubmissionRepo', () => ({
  findSubmitterSubmission: jest.fn(),
}));
jest.mock('../../../src/core/integrations/plugins/PluginRegistry', () => ({
  getDocumentGenerationPluginDefinitions: jest.fn(),
}));
jest.mock('../../../src/core/integrations/document-generation/DocumentGenerationRegistry', () => ({
  resolveDefaultDocumentGenerationCode: jest.fn(),
  createDocumentGenerationAdapter: jest.fn(),
}));
jest.mock('../../../src/core/db/repos/featureRepo', () => ({
  getFeatureGateCached: jest.fn(),
}));
jest.mock('../../../src/core/services/featureAvailabilityService', () => ({
  isFeatureAvailable: jest.fn(),
}));
const getContentMock = jest.fn();
jest.mock('../../../src/core/services/submissionService', () => ({
  SubmissionService: jest.fn().mockImplementation(() => ({ getContent: getContentMock })),
}));
jest.mock('../../../src/core/db/repos/documentGenerationAuditRepo', () => ({
  createDocumentGenerationAudit: jest.fn(),
}));
jest.mock('../../../src/core/db/repos/documentTemplateRepo', () => ({
  getLiveDocumentTemplate: jest.fn(),
  listLiveDocumentTemplates: jest.fn(),
}));
jest.mock('../../../src/core/services/fileStore', () => ({
  fileStore: { open: jest.fn() },
}));
jest.mock('../../../src/core/services/scanUpload', () => ({
  scanUpload: jest.fn(),
}));

import type { PrintOptions } from '@soba/lib';
import {
  documentGenerationService,
  staffDocumentService,
} from '../../../src/features/document-generation/service';
import { scanUpload } from '../../../src/core/services/scanUpload';
import * as submissionRepo from '../../../src/core/db/repos/submissionRepo';
import { findSubmitterSubmission } from '../../../src/core/db/repos/submitterSubmissionRepo';
import { storedSubmission } from '../../core/api/submit/storedSubmission';
import * as pluginRegistry from '../../../src/core/integrations/plugins/PluginRegistry';
import * as docgenRegistry from '../../../src/core/integrations/document-generation/DocumentGenerationRegistry';
import * as featureRepo from '../../../src/core/db/repos/featureRepo';
import * as availability from '../../../src/core/services/featureAvailabilityService';
import * as auditRepo from '../../../src/core/db/repos/documentGenerationAuditRepo';
import * as templateRepo from '../../../src/core/db/repos/documentTemplateRepo';
import { fileStore } from '../../../src/core/services/fileStore';
import { Readable } from 'node:stream';
import { ServiceUnavailableError } from '../../../src/core/errors';
import { HttpClientError } from '../../../src/core/http/httpClient';
import { httpErrorToAppError } from '../../../src/core/http/httpErrorMapper';

const getSubmissionRecordById = submissionRepo.getSubmissionRecordById as unknown as jest.Mock;
const readMock = jest.mocked(findSubmitterSubmission);
// Whether the caller holds a grant on the submission; the one read carries it.
const holdsGrant = jest.fn();
// Whether the submission, its form and its version are live; the one read is null otherwise.
const isLive = jest.fn();
const getDefs = pluginRegistry.getDocumentGenerationPluginDefinitions as unknown as jest.Mock;
const resolveDefault = docgenRegistry.resolveDefaultDocumentGenerationCode as unknown as jest.Mock;
const createAdapter = docgenRegistry.createDocumentGenerationAdapter as unknown as jest.Mock;
const getFeatureGateCached = featureRepo.getFeatureGateCached as unknown as jest.Mock;
const isFeatureAvailable = availability.isFeatureAvailable as unknown as jest.Mock;
const createAudit = auditRepo.createDocumentGenerationAudit as unknown as jest.Mock;
const getLiveTemplate = templateRepo.getLiveDocumentTemplate as unknown as jest.Mock;
const openFile = fileStore.open as unknown as jest.Mock;
const scanMock = jest.mocked(scanUpload);

const caller = { actorId: 'user-1', idpCode: 'idir' };
const scope = { workspaceId: 'ws-1', formId: 'form-1', formVersionId: 'fv-1' };
const renderMock = jest.fn();
const templateId = 'tpl-1';
const storedTemplate = {
  template: { id: templateId, formVersionId: 'fv-1', name: 'Receipt' },
  file: { id: 'file-1', profile: 'default', filename: 'receipt.docx', size: 9 },
};

beforeEach(() => {
  jest.clearAllMocks();
  isLive.mockReturnValue(true);
  getSubmissionRecordById.mockResolvedValue({ id: 's1', headRevisionId: 'rev-1' });
  readMock.mockImplementation(async () => {
    if (!isLive()) return null;
    const stored = storedSubmission({ role: (await holdsGrant()) ? 'owner' : null });
    return { ...stored, submission: { ...stored.submission, ...scope } };
  });
  getLiveTemplate.mockResolvedValue(storedTemplate);
  openFile.mockImplementation(async () => ({
    downloadStream: Readable.from(Buffer.from('tpl bytes')),
  }));
  getDefs.mockReturnValue([
    { code: 'cdogs-v2', featureCode: 'document-generation-v2' },
    { code: 'cdogs-v3', featureCode: 'document-generation-v3' },
    { code: 'docgen-noop' },
  ]);
  resolveDefault.mockReturnValue('cdogs-v2');
  getFeatureGateCached.mockImplementation((code: string) =>
    Promise.resolve(
      code === 'document-generation-v3'
        ? { enabled: true, availability: 'scoped' }
        : { enabled: true, availability: 'fixed' },
    ),
  );
  // Default: v2 available everywhere, v3 not granted for this scope.
  isFeatureAvailable.mockImplementation((code: string) =>
    Promise.resolve(code === 'document-generation-v2'),
  );
  renderMock.mockResolvedValue({ data: Buffer.from('doc'), contentType: 'application/pdf' });
  createAdapter.mockReturnValue({ render: renderMock });
  getContentMock.mockResolvedValue({ data: { field: 'saved' } });
  createAudit.mockResolvedValue(undefined);
  scanMock.mockResolvedValue('clean');
});

const print = (options?: PrintOptions) =>
  documentGenerationService.print(caller, { submissionId: 's1', templateId, options });

describe('documentGenerationService backend selection', () => {
  it('is notfound when the submission does not exist', async () => {
    isLive.mockReturnValue(false);
    const outcome = await print();
    expect(outcome.status).toBe('notfound');
  });

  it('renders via the default backend with the stored template and the options', async () => {
    holdsGrant.mockResolvedValue(true);
    const outcome = await print({ reportName: 'r' });
    expect(outcome).toMatchObject({ status: 'ok', code: 'cdogs-v2' });
    expect(createAdapter).toHaveBeenCalledWith('cdogs-v2');
    // Service passes the stored template's bytes and type; CDOGS-specific shaping is in the plugin.
    expect(renderMock).toHaveBeenCalledWith({
      template: { content: Buffer.from('tpl bytes'), fileType: 'docx' },
      options: { reportName: 'r' },
      data: { data: { field: 'saved' } },
    });
  });

  it('uses the granted scoped v3 backend over the default', async () => {
    holdsGrant.mockResolvedValue(true);
    isFeatureAvailable.mockResolvedValue(true); // v3 now granted for this scope
    const outcome = await print();
    expect(outcome).toMatchObject({ status: 'ok', code: 'cdogs-v3' });
    expect(createAdapter).toHaveBeenCalledWith('cdogs-v3');
  });

  it('is unavailable when no backend is available for the scope', async () => {
    holdsGrant.mockResolvedValue(true);
    isFeatureAvailable.mockResolvedValue(false); // neither v3 nor v2 available
    const outcome = await print();
    expect(outcome.status).toBe('unavailable');
  });

  it('does not let an available fixed non-default backend override the default', async () => {
    holdsGrant.mockResolvedValue(true);
    getDefs.mockReturnValue([
      { code: 'cdogs-v2', featureCode: 'document-generation-v2' },
      { code: 'other-fixed', featureCode: 'other-fixed' },
      { code: 'cdogs-v3', featureCode: 'document-generation-v3' },
      { code: 'docgen-noop' },
    ]);
    // Every feature available except the v3 grant; only a scoped backend may override the default.
    isFeatureAvailable.mockImplementation((code: string) =>
      Promise.resolve(code !== 'document-generation-v3'),
    );
    const outcome = await print();
    expect(outcome).toMatchObject({ status: 'ok', code: 'cdogs-v2' });
  });

  it('is unavailable when the configured default backend is not installed', async () => {
    holdsGrant.mockResolvedValue(true);
    resolveDefault.mockReturnValue('cdogs-v99'); // no such plugin installed
    isFeatureAvailable.mockResolvedValue(false); // and no scoped grant
    const outcome = await print();
    expect(outcome.status).toBe('unavailable');
  });
});

describe('documentGenerationService.print', () => {
  it('lets a participant print the persisted submission', async () => {
    holdsGrant.mockResolvedValue(true);

    const outcome = await print();

    expect(outcome).toMatchObject({ status: 'ok' });
    expect(readMock).toHaveBeenCalledWith({ submissionId: 's1', ...caller });
    expect(getLiveTemplate).toHaveBeenCalledWith(templateId, scope.formVersionId, 'cdogs');
    // Service passes the raw persisted doc through; the plugin flattens it for the template.
    expect(renderMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: { data: { field: 'saved' } } }),
    );
  });

  it('denies a caller who is not a participant, whatever their form permissions', async () => {
    holdsGrant.mockResolvedValue(false);

    const outcome = await print();

    expect(outcome.status).toBe('denied');
  });

  it('is no-content when the submission has no persisted data', async () => {
    holdsGrant.mockResolvedValue(true);
    getContentMock.mockResolvedValue(null);

    const outcome = await print();

    expect(outcome.status).toBe('no-content');
  });
});

describe('documentGenerationService audit', () => {
  it('records a success audit for the backend call', async () => {
    holdsGrant.mockResolvedValue(true);

    await print();

    expect(createAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-1',
        formId: 'form-1',
        submissionId: 's1',
        mode: 'print',
        backendCode: 'cdogs-v2',
        outcome: 'success',
        templateId,
        templateFileId: 'file-1',
        revisionId: 'rev-1',
        createdBy: 'user-1',
      }),
    );
  });

  it('records an error audit and returns error when the backend throws', async () => {
    holdsGrant.mockResolvedValue(true);
    renderMock.mockRejectedValue(
      httpErrorToAppError(new HttpClientError(500, 'Error', 'boom', 'http://cdogs.test'), 'CDOGS'),
    );

    const outcome = await print();

    expect(outcome.status).toBe('error');
    expect(createAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        backendCode: 'cdogs-v2',
        outcome: 'error',
        httpStatus: 503,
        // PI-safe: the error class and upstream status, not the upstream body ('boom').
        errorDetail: 'ServiceUnavailableError upstream 500',
      }),
    );
  });

  it('audits and returns a 503 when the backend fails to construct (misconfigured)', async () => {
    holdsGrant.mockResolvedValue(true);
    // A granted-but-unconfigured backend throws a plain Error during construction.
    createAdapter.mockImplementation(() => {
      throw new Error('PLUGIN_CDOGS_V3_ENDPOINT is required');
    });

    const outcome = await print();

    expect(outcome.status).toBe('error');
    expect((outcome as { error: unknown }).error).toBeInstanceOf(ServiceUnavailableError);
    expect(createAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'error',
        httpStatus: 503,
        errorDetail: 'ServiceUnavailableError',
      }),
    );
  });

  it('does not fail the render when the audit write fails', async () => {
    holdsGrant.mockResolvedValue(true);
    createAudit.mockRejectedValue(new Error('audit db down'));

    const outcome = await print();

    expect(outcome.status).toBe('ok');
  });

  it.each([
    ['not a template file type', { filename: 'receipt.txt', size: 9 }],
    ['over the template size limit', { filename: 'receipt.docx', size: Number.MAX_SAFE_INTEGER }],
  ])('refuses a stored template that is %s with render_failed', async (_label, file) => {
    holdsGrant.mockResolvedValue(true);
    getLiveTemplate.mockResolvedValue({
      ...storedTemplate,
      file: { ...storedTemplate.file, ...file },
    });
    const outcome = await print();
    expect(outcome).toMatchObject({ status: 'error', error: { code: 'render_failed' } });
    expect(renderMock).not.toHaveBeenCalled();
  });

  it('does not audit when no backend call is made', async () => {
    // denied: never reaches the backend
    holdsGrant.mockResolvedValue(false);
    await print();

    // unavailable: no backend resolved
    holdsGrant.mockResolvedValue(true);
    isFeatureAvailable.mockResolvedValue(false);
    await print();

    // no-content: no persisted data, so no backend call
    isFeatureAvailable.mockImplementation((code: string) =>
      Promise.resolve(code === 'document-generation-v2'),
    );
    getContentMock.mockResolvedValue(null);
    await print();

    expect(createAudit).not.toHaveBeenCalled();
  });
});

describe('staffDocumentService.printUpload', () => {
  const prepared = { scope, submissionId: 's1', backendCode: 'cdogs-v2' };
  const template = {
    content: Buffer.from('uploaded'),
    fileType: 'docx' as const,
    filename: 't.docx',
  };
  const options: PrintOptions = { convertTo: 'pdf' };
  const printUpload = () => staffDocumentService.printUpload(prepared, template, options, 'user-1');

  it.each(['infected', 'scan-unavailable'] as const)(
    'never reads, renders or audits a template the scan calls %s',
    async (verdict) => {
      scanMock.mockResolvedValue(verdict);
      const outcome = await printUpload();
      expect(outcome.status).toBe(verdict);
      expect(getContentMock).not.toHaveBeenCalled();
      expect(createAdapter).not.toHaveBeenCalled();
      expect(renderMock).not.toHaveBeenCalled();
      expect(createAudit).not.toHaveBeenCalled();
    },
  );

  it('renders a clean template with the saved answers and audits it with no stored template', async () => {
    const outcome = await printUpload();
    expect(outcome).toMatchObject({ status: 'ok', code: 'cdogs-v2' });
    expect(scanMock).toHaveBeenCalledWith(Buffer.from('uploaded'), 't.docx');
    expect(renderMock).toHaveBeenCalledWith({
      template: { content: Buffer.from('uploaded'), fileType: 'docx' },
      options,
      data: { data: { field: 'saved' } },
    });
    expect(createAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-1',
        formId: 'form-1',
        submissionId: 's1',
        mode: 'print',
        backendCode: 'cdogs-v2',
        outcome: 'success',
        templateId: null,
        templateFileId: null,
        revisionId: 'rev-1',
        createdBy: 'user-1',
      }),
    );
  });

  it.each([
    ['gone once the scan ends', 'notfound', () => getSubmissionRecordById.mockResolvedValue(null)],
    ['without saved answers', 'no-content', () => getContentMock.mockResolvedValue(null)],
  ] as const)('does not render a submission %s', async (_label, status, arrange) => {
    arrange();
    const outcome = await printUpload();
    expect(outcome.status).toBe(status);
    expect(renderMock).not.toHaveBeenCalled();
  });
});
