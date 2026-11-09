import { queuesSubmittedJob } from '../../../src/core/jobs/enqueue';

jest.mock('../../../src/core/db/client', () => ({ db: {}, quietDb: {} }));

describe('queuesSubmittedJob', () => {
  it('queues a submit where post-submission is available', async () => {
    await expect(queuesSubmittedJob('submitted', () => Promise.resolve(true))).resolves.toBe(true);
  });

  it('does not queue a submit where post-submission is not available', async () => {
    await expect(queuesSubmittedJob('submitted', () => Promise.resolve(false))).resolves.toBe(
      false,
    );
  });

  it('never queues a save, and does not check availability for one', async () => {
    const isAvailable = jest.fn().mockResolvedValue(true);
    await expect(queuesSubmittedJob('saved', isAvailable)).resolves.toBe(false);
    expect(isAvailable).not.toHaveBeenCalled();
  });
});
