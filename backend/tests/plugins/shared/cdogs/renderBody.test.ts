import { toCdogsRenderBody } from '../../../../src/plugins/shared/cdogs/renderBody';
import type { DocumentRenderRequest } from '../../../../src/core/integrations/document-generation/DocumentGenerationAdapter';

const content = Buffer.from('template bytes');

const request = (overrides: Partial<DocumentRenderRequest> = {}): DocumentRenderRequest => ({
  template: { content, fileType: 'docx' },
  options: {},
  data: {},
  ...overrides,
});

describe('toCdogsRenderBody', () => {
  it('sends the template as base64 with its file type', () => {
    const body = toCdogsRenderBody(request({ template: { content, fileType: 'xlsx' } }));
    expect(body.template).toEqual({
      content: content.toString('base64'),
      encodingType: 'base64',
      fileType: 'xlsx',
    });
  });

  it('carries only the CDOGS fields, with no Buffer left to serialize', () => {
    const body = toCdogsRenderBody(request());
    expect(Object.keys(body).sort()).toEqual(['data', 'options', 'template']);
    expect(JSON.stringify(body)).not.toContain('"type":"Buffer"');
  });

  it('forces overwrite:true while preserving other options', () => {
    const body = toCdogsRenderBody(request({ options: { reportName: 'r' } }));
    expect(body.options).toEqual({ reportName: 'r', overwrite: true });
  });

  it('flattens the form-engine .data wrapper so templates use {d.field}', () => {
    const body = toCdogsRenderBody(request({ data: { data: { textField: 'saved' }, form: 'f' } }));
    expect(body.data).toEqual({ textField: 'saved' });
  });

  it('passes already-flat data through unchanged', () => {
    const body = toCdogsRenderBody(request({ data: { textField: 'live' } }));
    expect(body.data).toEqual({ textField: 'live' });
  });
});
