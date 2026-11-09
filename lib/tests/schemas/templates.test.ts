import {
  PrintBodySchema,
  PrintOptionsSchema,
  TemplateNameBodySchema,
  TemplateResponseSchema,
  TemplateUploadBodySchema,
  TemplatesFormQuerySchema,
  TemplateVersionQuerySchema,
  templateExtensionsText,
  templateFileAccept,
  templateFileTypeFor,
} from '../../src/schemas/templates';

const UUID = '11111111-1111-4111-8111-111111111111';

describe('templateFileTypeFor', () => {
  it.each([
    ['r.docx', 'docx'],
    ['R.DOCX', 'docx'],
    ['sheet.xlsx', 'xlsx'],
    ['page.html', 'html'],
  ])('reads %s as %s for a CDOGS template', (name, type) => {
    expect(templateFileTypeFor('cdogs', name)).toBe(type);
  });

  it.each(['deck.pptx', 'r.odt', 'r.doc', 'r.pdf', 'r.docx.exe', 'docx', '.docx', 'r.', ''])(
    'refuses %j for a CDOGS template',
    (name) => {
      expect(templateFileTypeFor('cdogs', name)).toBeNull();
    },
  );
});

describe('template type file rules', () => {
  it('describes the accepted extensions for messages and file inputs', () => {
    expect(templateExtensionsText('cdogs')).toBe('docx, xlsx, html');
    expect(templateFileAccept('cdogs')).toBe('.docx,.xlsx,.html');
  });
});

describe('template schemas', () => {
  it('requires a UUID form id to list and a UUID form version id to upload', () => {
    expect(TemplatesFormQuerySchema.safeParse({ formId: UUID }).success).toBe(true);
    expect(TemplatesFormQuerySchema.safeParse({ formId: 'engine' }).success).toBe(false);
    expect(TemplateVersionQuerySchema.safeParse({ formVersionId: UUID }).success).toBe(true);
    expect(TemplateVersionQuerySchema.safeParse({ formVersionId: 'engine' }).success).toBe(false);
  });

  it('requires a known type on upload and leaves the name optional', () => {
    expect(TemplateUploadBodySchema.parse({ type: 'cdogs' })).toEqual({ type: 'cdogs' });
    expect(TemplateUploadBodySchema.parse({ type: 'cdogs', name: '  Receipt  ' })).toEqual({
      type: 'cdogs',
      name: 'Receipt',
    });
    expect(TemplateUploadBodySchema.safeParse({ name: 'Receipt' }).success).toBe(false);
    expect(TemplateUploadBodySchema.safeParse({ type: 'print-css' }).success).toBe(false);
    expect(
      TemplateUploadBodySchema.safeParse({ type: 'cdogs', name: 'x'.repeat(101) }).success,
    ).toBe(false);
  });

  it('trims and bounds a rename', () => {
    expect(TemplateNameBodySchema.parse({ name: '  Annual report  ' })).toEqual({
      name: 'Annual report',
    });
    expect(TemplateNameBodySchema.safeParse({ name: '   ' }).success).toBe(false);
    expect(TemplateNameBodySchema.safeParse({ name: 'x'.repeat(101) }).success).toBe(false);
  });

  it('validates template response metadata', () => {
    const response = {
      id: UUID,
      formId: '22222222-2222-4222-8222-222222222222',
      formVersionId: '33333333-3333-4333-8333-333333333333',
      formVersionNo: 2,
      type: 'cdogs',
      name: 'Annual report',
      filename: 'report.docx',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size: 512,
      createdBy: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedBy: null,
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    expect(TemplateResponseSchema.safeParse(response).success).toBe(true);
    expect(TemplateResponseSchema.safeParse({ ...response, type: 'other' }).success).toBe(false);
    expect(TemplateResponseSchema.safeParse({ ...response, size: '512' }).success).toBe(false);
  });
});

describe('print schemas', () => {
  it('takes pdf and a report name, and nothing else', () => {
    expect(PrintOptionsSchema.parse({ convertTo: 'pdf', reportName: ' Receipt ' })).toEqual({
      convertTo: 'pdf',
      reportName: 'Receipt',
    });
    expect(PrintOptionsSchema.parse({})).toEqual({});
    expect(PrintOptionsSchema.safeParse({ convertTo: 'docx' }).success).toBe(false);
    expect(PrintOptionsSchema.safeParse({ reportName: ' ' }).success).toBe(false);
    expect(PrintOptionsSchema.safeParse({ reportName: 'x'.repeat(256) }).success).toBe(false);
    expect(PrintOptionsSchema.safeParse({ overwrite: false }).success).toBe(false);
  });

  it('takes a report name with whole characters only', () => {
    expect(PrintOptionsSchema.safeParse({ reportName: 'Receipt \u{1F600}' }).success).toBe(true);
    expect(PrintOptionsSchema.safeParse({ reportName: 'Receipt \uD83D' }).success).toBe(false);
    expect(PrintOptionsSchema.safeParse({ reportName: '\uDE00 Receipt' }).success).toBe(false);
  });

  it('takes a template id and the options, and nothing else', () => {
    expect(PrintBodySchema.safeParse({ templateId: UUID }).success).toBe(true);
    expect(PrintBodySchema.safeParse({ templateId: 'x' }).success).toBe(false);
    expect(PrintBodySchema.safeParse({ templateId: UUID, data: {} }).success).toBe(false);
    expect(
      PrintBodySchema.safeParse({ templateId: UUID, options: { convertTo: 'html' } }).success,
    ).toBe(false);
  });
});
