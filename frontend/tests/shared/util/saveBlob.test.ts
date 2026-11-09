import { describe, it, expect, vi, afterEach } from 'vitest';
import { saveBlob } from '@/src/shared/util/saveBlob';

describe('saveBlob', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('downloads under the given name and revokes the URL only after the click', () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn(() => 'blob:doc');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      expect(this.download).toBe('receipt.docx');
      expect(this.href).toBe('blob:doc');
    });

    saveBlob(new Blob(['x']), 'receipt.docx');

    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:doc');
    vi.unstubAllGlobals();
  });
});
