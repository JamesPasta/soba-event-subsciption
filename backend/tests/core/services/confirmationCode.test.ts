import {
  newConfirmationCode,
  withNewConfirmationCode,
} from '../../../src/core/services/confirmationCode';
import { SUBMISSION_CONFIRMATION_CODE_UNIQUE } from '../../../src/core/db/schema';

const CROCKFORD = /^[0-9A-HJKMNP-TV-Z]{8}$/;

// The shape pg's DatabaseError has once Drizzle wraps it.
const uniqueViolation = (constraint: string) =>
  Object.assign(new Error('insert failed'), {
    cause: { code: '23505', severity: 'ERROR', constraint },
  });

describe('newConfirmationCode', () => {
  it('draws 8 characters from the Crockford base32 alphabet', () => {
    for (let i = 0; i < 500; i++) {
      expect(newConfirmationCode()).toMatch(CROCKFORD);
    }
  });

  it('draws different codes', () => {
    const codes = new Set(Array.from({ length: 1000 }, newConfirmationCode));
    expect(codes.size).toBe(1000);
  });
});

describe('withNewConfirmationCode', () => {
  it('writes once when the code is free', async () => {
    const write = jest.fn().mockResolvedValue('ok');
    await expect(withNewConfirmationCode(write)).resolves.toBe('ok');
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][0]).toMatch(CROCKFORD);
  });

  it('retries with another code when the code is taken', async () => {
    const write = jest
      .fn()
      .mockRejectedValueOnce(uniqueViolation(SUBMISSION_CONFIRMATION_CODE_UNIQUE))
      .mockResolvedValue('ok');
    await expect(withNewConfirmationCode(write)).resolves.toBe('ok');
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1][0]).not.toBe(write.mock.calls[0][0]);
  });

  it('gives up after three taken codes', async () => {
    const taken = uniqueViolation(SUBMISSION_CONFIRMATION_CODE_UNIQUE);
    const write = jest.fn().mockRejectedValue(taken);
    await expect(withNewConfirmationCode(write)).rejects.toBe(taken);
    expect(write).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['a unique violation on another constraint', uniqueViolation('submission_pkey')],
    ['any other error', new Error('connection reset')],
  ])('does not retry %s', async (_label, error) => {
    const write = jest.fn().mockRejectedValue(error);
    await expect(withNewConfirmationCode(write)).rejects.toBe(error);
    expect(write).toHaveBeenCalledTimes(1);
  });
});
