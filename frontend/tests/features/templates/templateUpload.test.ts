import { describe, expect, it } from 'vitest';
import { ApiError } from '@/src/shared/api/sobaHelpers';
import { SessionExpiredError } from '@/src/shared/api/sobaFetch';
import {
  availableTemplateTypes,
  rereadAfter,
  templateOn,
  uploadErrorText,
  versionOptions,
} from '@/src/features/templates/templateUpload';
import type { FormVersionSummary } from '@/src/types/forms';
import type { TemplateResponse } from '@/src/types/templates';

const version = (id: string, versionNo: number, state: string): FormVersionSummary =>
  ({ id, versionNo, state }) as FormVersionSummary;

const template = (id: string, formVersionId: string): TemplateResponse => ({
  id,
  formId: 'form-1',
  formVersionId,
  formVersionNo: 1,
  type: 'cdogs',
  name: 'CDOGS',
  filename: 'r.docx',
  contentType: null,
  size: 1,
  createdBy: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedBy: null,
  updatedAt: '2026-01-01T00:00:00.000Z',
});

describe('versionOptions', () => {
  it('lists the current version first, then the others without it', () => {
    const current = version('v3', 3, 'draft');
    const others = [current, version('v2', 2, 'published'), version('v1', 1, 'published')];
    expect(versionOptions(current, others)).toEqual([
      { id: 'v3', label: 'v3 (draft)' },
      { id: 'v2', label: 'v2 (published)' },
      { id: 'v1', label: 'v1 (published)' },
    ]);
  });

  it('lists the current version even when the lookup stopped short of it', () => {
    const current = version('v9', 9, 'draft');
    expect(versionOptions(current, [version('v1', 1, 'published')]).map((o) => o.id)).toEqual([
      'v9',
      'v1',
    ]);
  });

  it('lists the others when the form has no current version yet', () => {
    expect(versionOptions(null, [version('v1', 1, 'draft')])).toEqual([
      { id: 'v1', label: 'v1 (draft)' },
    ]);
  });
});

describe('templateOn', () => {
  const templates = [template('t1', 'v1'), template('t2', 'v2')];

  it('finds the template of the type on the version', () => {
    expect(templateOn(templates, 'v2', 'cdogs')?.id).toBe('t2');
  });

  it('finds nothing on a version without one, or with no version chosen', () => {
    expect(templateOn(templates, 'v3', 'cdogs')).toBeNull();
    expect(templateOn(templates, null, 'cdogs')).toBeNull();
  });
});

describe('availableTemplateTypes', () => {
  it("offers a type only when its feature is available, asking by the type's feature", async () => {
    const asked: string[] = [];
    const types = await availableTemplateTypes(async (code) => {
      asked.push(code);
      return true;
    });
    expect(types).toEqual(['cdogs']);
    expect(asked).toEqual(['document-generation']);
  });

  it('offers nothing when no feature is available', async () => {
    expect(await availableTemplateTypes(async () => false)).toEqual([]);
  });
});

describe('rereadAfter', () => {
  it('re-reads after the write and settles with its value', async () => {
    const order: string[] = [];
    const write = Promise.resolve('written').then((value) => {
      order.push('write');
      return value;
    });
    const value = await rereadAfter(write, async () => {
      order.push('reread');
    });
    expect(value).toBe('written');
    expect(order).toEqual(['write', 'reread']);
  });

  it("keeps a write's success when the re-read fails", async () => {
    await expect(
      rereadAfter(Promise.resolve('written'), () => Promise.reject(new Error('reread'))),
    ).resolves.toBe('written');
  });

  it("keeps a write's own error when the re-read fails too", async () => {
    const refused = new ApiError('refused', 409);
    let reread = false;
    await expect(
      rereadAfter(Promise.reject(refused), () => {
        reread = true;
        return Promise.reject(new Error('reread'));
      }),
    ).rejects.toBe(refused);
    expect(reread).toBe(true);
  });
});

describe('uploadErrorText', () => {
  const text = {
    failed: 'failed',
    typeTaken: 'type taken',
    replaceConflict: 'replace conflict',
    tooLarge: 'too large',
    wrongType: 'wrong type',
    scanFailed: 'scan failed',
    sessionExpired: 'session expired',
    forbidden: 'forbidden',
  };

  it.each([
    [413, 'too large'],
    [415, 'wrong type'],
    [422, 'scan failed'],
    [403, 'forbidden'],
    [400, 'failed'],
    [500, 'failed'],
  ])('reports a %i as %j', (status, message) => {
    expect(uploadErrorText(new ApiError('refused', status), text, false)).toBe(message);
    expect(uploadErrorText(new ApiError('refused', status), text, true)).toBe(message);
  });

  it('reports a 409 as a taken type on an upload and a changed template on a replace', () => {
    const conflict = new ApiError('conflict', 409);
    expect(uploadErrorText(conflict, text, false)).toBe('type taken');
    expect(uploadErrorText(conflict, text, true)).toBe('replace conflict');
  });

  it('reports an ended session, and anything else as a failure', () => {
    expect(uploadErrorText(new SessionExpiredError(), text, false)).toBe('session expired');
    expect(uploadErrorText(new TypeError('Failed to fetch'), text, false)).toBe('failed');
  });
});
