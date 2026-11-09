import { describe, it, expect, vi, afterEach } from 'vitest';
import { downloadTemplate } from '@/src/features/templates/data/api';

describe('downloadTemplate', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the template file', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('docx'));
    vi.stubGlobal('fetch', fetchMock);

    const blob = await downloadTemplate('tok', 't1');

    expect(blob.size).toBe(4);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/templates/t1/content');
  });

  it('throws a refused download with the server message and code', async () => {
    const refusal = new Response(JSON.stringify({ error: 'Denied', code: 'read_denied' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(refusal));

    await expect(downloadTemplate('tok', 't1')).rejects.toMatchObject({
      status: 403,
      message: 'Denied',
      code: 'read_denied',
    });
  });
});
