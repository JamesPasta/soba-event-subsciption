import {
  checkDocumentGenerationReadiness,
  createDefaultDocumentGenerationAdapter,
  createDocumentGenerationAdapter,
  getDocumentGenerationPlugins,
  resolveDefaultDocumentGenerationCode,
  resolveDocumentGenerationPlugin,
} from '../../../../src/core/integrations/document-generation/DocumentGenerationRegistry';

describe('DocumentGenerationRegistry', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('discovers the cdogs and noop plugins in its catalog', () => {
    const codes = getDocumentGenerationPlugins().map((p) => p.code);
    expect(codes).toEqual(expect.arrayContaining(['cdogs-v2', 'cdogs-v3', 'docgen-noop']));
  });

  it('resolves a plugin by code and rejects unknown codes', () => {
    expect(resolveDocumentGenerationPlugin('cdogs-v3').metadata.version).toBe('v3');
    expect(() => resolveDocumentGenerationPlugin('nope')).toThrow(/No document generation plugin/);
  });

  it('creates an adapter for a configured backend', () => {
    process.env.PLUGIN_CDOGS_V3_ENDPOINT = 'http://cdogs3.test/api';
    const adapter = createDocumentGenerationAdapter('cdogs-v3');
    expect(typeof adapter.render).toBe('function');
  });

  it('defaults the backend to docgen-noop, honouring the env override', () => {
    delete process.env.DOCUMENT_GENERATION_DEFAULT_CODE;
    expect(resolveDefaultDocumentGenerationCode()).toBe('docgen-noop');

    process.env.DOCUMENT_GENERATION_DEFAULT_CODE = 'cdogs-v3';
    expect(resolveDefaultDocumentGenerationCode()).toBe('cdogs-v3');
  });

  it('creates the default adapter without external config (noop)', async () => {
    delete process.env.DOCUMENT_GENERATION_DEFAULT_CODE;
    const adapter = createDefaultDocumentGenerationAdapter();
    const res = await adapter.render({
      template: { content: Buffer.from('x'), fileType: 'docx' },
      options: {},
      data: {},
    });
    expect(res.contentType).toBe('text/plain');
  });

  it('reports readiness per backend, failing those missing config', async () => {
    process.env.PLUGIN_CDOGS_V3_ENDPOINT = 'http://cdogs3.test/api';
    delete process.env.PLUGIN_CDOGS_V2_ENDPOINT;
    delete process.env.PLUGIN_CDOGS_V2_TOKEN_URL;
    delete process.env.PLUGIN_CDOGS_V2_CLIENT_ID;
    delete process.env.PLUGIN_CDOGS_V2_CLIENT_SECRET;

    const readiness = await checkDocumentGenerationReadiness();

    expect(readiness['docgen-noop']).toEqual({ ok: true });
    expect(readiness['cdogs-v3']).toEqual({ ok: true });
    expect(readiness['cdogs-v2'].ok).toBe(false);
  });
});
