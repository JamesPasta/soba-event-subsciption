import { backoffDelayMs, jitteredMs, withRetries } from '../../../src/core/jobs/timing';

const backoff = { backoffBaseMs: 30_000, backoffMaxMs: 1_800_000 };

describe('backoffDelayMs', () => {
  it('starts at the base and doubles per attempt', () => {
    expect([1, 2, 3, 4].map((attempt) => backoffDelayMs(attempt, backoff))).toEqual([
      30_000, 60_000, 120_000, 240_000,
    ]);
  });

  it('stops at the cap', () => {
    expect(backoffDelayMs(7, backoff)).toBe(1_800_000);
    expect(backoffDelayMs(2000, backoff)).toBe(1_800_000);
  });
});

describe('jitteredMs', () => {
  it('stays within a fifth either way', () => {
    expect(jitteredMs(2000, () => 0)).toBe(1600);
    expect(jitteredMs(2000, (max) => max - 1)).toBe(2400);
  });

  it('asks for a value across the whole spread', () => {
    const random = jest.fn().mockReturnValue(0);
    jitteredMs(10_000, random);
    expect(random).toHaveBeenCalledWith(4001);
  });

  it('never goes past the largest timer delay', () => {
    expect(jitteredMs(2_147_483_647, (max) => max - 1)).toBe(2_147_483_647);
  });

  it('leaves a delay too short to spread unchanged', () => {
    expect(jitteredMs(0)).toBe(0);
    expect(jitteredMs(4)).toBe(4);
  });
});

describe('withRetries', () => {
  it('returns once a try succeeds', async () => {
    const write = jest
      .fn()
      .mockRejectedValueOnce(new Error('blip'))
      .mockRejectedValueOnce(new Error('blip'))
      .mockResolvedValue(true);
    await expect(withRetries(write, 3, 0)).resolves.toBe(true);
    expect(write).toHaveBeenCalledTimes(3);
  });

  it('throws the last error once the retries are used up', async () => {
    const write = jest.fn().mockRejectedValue(new Error('down'));
    await expect(withRetries(write, 2, 0)).rejects.toThrow('down');
    expect(write).toHaveBeenCalledTimes(3);
  });
});
