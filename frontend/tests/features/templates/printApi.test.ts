import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  printWithStoredTemplate,
  printWithUploadedTemplate,
} from '@/src/features/templates/data/printApi';

const documentResponse = (): Response =>
  new Response('%PDF', { headers: { 'Content-Type': 'application/pdf' } });

const refusal = (): Response =>
  new Response(JSON.stringify({ error: 'Denied', code: 'read_denied' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  });

describe('printApi', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the rendered document from a stored template', async () => {
    const fetchMock = vi.fn().mockResolvedValue(documentResponse());
    vi.stubGlobal('fetch', fetchMock);

    const blob = await printWithStoredTemplate('design', 'tok', 's1', 't1', { convertTo: 'pdf' });

    expect(blob.size).toBe(4);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/design/submissions/s1/print');
    expect(JSON.parse(init.body)).toEqual({ templateId: 't1', options: { convertTo: 'pdf' } });
  });

  it('returns the rendered document from an uploaded template', async () => {
    const fetchMock = vi.fn().mockResolvedValue(documentResponse());
    vi.stubGlobal('fetch', fetchMock);

    const blob = await printWithUploadedTemplate('tok', 's1', new File(['x'], 't.docx'), {});

    expect(blob.size).toBe(4);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/design/print-upload/s1');
  });

  it('throws a refused render with its status and code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(refusal()));

    await expect(
      printWithStoredTemplate('submit', undefined, 's1', 't1', {}),
    ).rejects.toMatchObject({ status: 403, code: 'read_denied' });
  });
});
