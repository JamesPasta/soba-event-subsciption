import { cancelReason, type ActionRunFacts } from '../../../src/features/post-submission/actionJob';

jest.mock('../../../src/core/db/client', () => ({ db: {}, quietDb: {} }));

const ready: ActionRunFacts = {
  postSubmissionAvailable: true,
  enabledHere: true,
  featureAvailable: true,
  live: true,
  stillEnabled: true,
};

describe('cancelReason', () => {
  it('runs the action when every check passes', () => {
    expect(cancelReason(ready)).toBeNull();
  });

  it.each([
    ['postSubmissionAvailable', 'Post-submission is not available for the form'],
    ['enabledHere', 'The action is not enabled in this environment'],
    ['featureAvailable', "The action's feature is not available for the form"],
    ['live', 'The submission, its form or its workspace is gone'],
    ['stillEnabled', 'The action was turned off'],
  ] as const)('cancels when %s fails', (fact, reason) => {
    expect(cancelReason({ ...ready, [fact]: false })).toBe(reason);
  });
});
