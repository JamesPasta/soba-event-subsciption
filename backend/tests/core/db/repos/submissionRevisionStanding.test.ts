import { RevisionReason, RevisionStatus } from '../../../../src/core/db/codes';
import { resolveRevisionStanding } from '../../../../src/core/db/repos/submissionRevisionChain';

const standing = (headMoved: boolean, workflowState: string) =>
  resolveRevisionStanding(
    RevisionStatus.current,
    RevisionReason.accepted,
    headMoved,
    workflowState,
  );

describe('resolveRevisionStanding', () => {
  it.each(['draft', 'revising'])('applies a current write on an open %s submission', (state) => {
    expect(standing(false, state)).toEqual({
      applyAsCurrent: true,
      status: RevisionStatus.current,
      reason: RevisionReason.accepted,
    });
  });

  it('holds a current write as a conflict when only the head moved', () => {
    expect(standing(true, 'revising')).toEqual({
      applyAsCurrent: false,
      status: RevisionStatus.pending,
      reason: RevisionReason.conflict,
    });
  });

  // Ending a revision with no saves in it submits the submission without moving its head.
  it.each([true, false])(
    'holds a current write as closed once submitted (head moved: %s)',
    (moved) => {
      expect(standing(moved, 'submitted')).toEqual({
        applyAsCurrent: false,
        status: RevisionStatus.pending,
        reason: RevisionReason.closed,
      });
    },
  );

  it("keeps a pending write on the gate's reason", () => {
    expect(
      resolveRevisionStanding(RevisionStatus.pending, RevisionReason.conflict, false, 'submitted'),
    ).toEqual({
      applyAsCurrent: false,
      status: RevisionStatus.pending,
      reason: RevisionReason.conflict,
    });
  });
});
