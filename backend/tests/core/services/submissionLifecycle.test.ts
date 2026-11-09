import { SUBMISSION_EDITABLE_STATES, SUBMISSION_IN_PROGRESS_STATES } from '@soba/lib';
import { isTerminalSubmissionState } from '../../../src/core/services/submissionLifecycle';

describe('SUBMISSION_IN_PROGRESS_STATES', () => {
  it('holds no terminal state', () => {
    expect(SUBMISSION_IN_PROGRESS_STATES.filter(isTerminalSubmissionState)).toEqual([]);
  });

  // The write gate takes their writes as current: no state its submitters edit in is terminal.
  it('leaves every state its submitters edit in open to writes', () => {
    expect(SUBMISSION_EDITABLE_STATES.filter(isTerminalSubmissionState)).toEqual([]);
  });
});
