jest.mock('../../../src/core/db/client', () => ({ db: {} }));

import { storedOrThrow } from '../../../src/core/services/fileStore';
import { ServiceUnavailableError, UnprocessableEntityError } from '../../../src/core/errors';
import type { FileRecord } from '../../../src/core/db/repos/fileRepo';

describe('storedOrThrow', () => {
  it.each([
    ['infected', 'file_infected', UnprocessableEntityError],
    ['scan-unavailable', 'scan_unavailable', ServiceUnavailableError],
  ] as const)('refuses a file that is %s with %s', (outcome, code, type) => {
    const refusal = (() => {
      try {
        storedOrThrow(outcome);
      } catch (err) {
        return err;
      }
      throw new Error('expected storedOrThrow to throw');
    })();
    expect(refusal).toBeInstanceOf(type);
    expect(refusal).toMatchObject({ code });
  });

  it('returns a stored record as is', () => {
    const record = { id: 'f1' } as FileRecord;
    expect(storedOrThrow(record)).toBe(record);
  });
});
