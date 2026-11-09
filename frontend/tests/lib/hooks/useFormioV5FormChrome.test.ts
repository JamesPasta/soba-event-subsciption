import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('@/src/features/formio-v5/disableFormioBrowserAuth', () => ({
  disableFormioBrowserAuth: vi.fn(),
}));

import { useFormioV5FormChrome } from '@/lib/hooks/useFormioV5FormChrome';

describe('useFormioV5FormChrome', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('loads the Form.io stylesheets from under the base path', () => {
    vi.stubEnv('NEXT_PUBLIC_BASE_PATH', '/designer');
    const { unmount } = renderHook(() => useFormioV5FormChrome('build'));

    expect(document.getElementById('soba-formio-styles')?.textContent).toBe(
      '@import url("/designer/formio-v5/formio.full.min.css") layer(formio);\n' +
        '@import url("/designer/formio-v5/bcgov-file.css") layer(formio);',
    );
    unmount();
  });
});
