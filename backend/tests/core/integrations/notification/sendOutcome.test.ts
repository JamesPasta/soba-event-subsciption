import {
  hasRunStarted,
  isHandledForRun,
  isHandledSend,
  isRefusedSend,
} from '../../../../src/core/integrations/notification/sendOutcome';

describe('send outcomes', () => {
  it.each([400, 422])('counts a %i as the provider refusing the address', (httpStatus) => {
    expect(isRefusedSend({ outcome: 'error', httpStatus })).toBe(true);
    expect(isHandledSend({ outcome: 'error', httpStatus })).toBe(true);
  });

  it.each([401, 403, 404, 408, 429, 500, 503, null])(
    'treats an error with status %s as the provider or its gateway, to be retried',
    (httpStatus) => {
      expect(isRefusedSend({ outcome: 'error', httpStatus })).toBe(false);
      expect(isHandledSend({ outcome: 'error', httpStatus })).toBe(false);
    },
  );

  it('counts an accepted send and one the noop plugin skipped as handled', () => {
    expect(isHandledSend({ outcome: 'accepted', httpStatus: null })).toBe(true);
    expect(isHandledSend({ outcome: 'not_sent', httpStatus: null })).toBe(true);
  });

  it('does not count a send skipped because notifications were off', () => {
    expect(isHandledSend({ outcome: 'disabled', httpStatus: null })).toBe(false);
  });
});

describe('isHandledForRun', () => {
  const rerunAt = new Date('2026-10-28T12:00:00Z');
  const before = new Date('2026-10-28T11:00:00Z');
  const after = new Date('2026-10-28T12:01:00Z');
  const refused = { outcome: 'error', httpStatus: 400 } as const;
  const accepted = { outcome: 'accepted', httpStatus: null } as const;

  it('tries an address refused before the last re-run again', () => {
    expect(isHandledForRun({ ...refused, createdAt: before }, rerunAt)).toBe(false);
  });

  it('keeps an address refused since the last re-run, or on a job never re-run', () => {
    expect(isHandledForRun({ ...refused, createdAt: after }, rerunAt)).toBe(true);
    expect(isHandledForRun({ ...refused, createdAt: before }, null)).toBe(true);
  });

  it('never sends again to an address accepted before the re-run', () => {
    expect(isHandledForRun({ ...accepted, createdAt: before }, rerunAt)).toBe(true);
  });

  it('retries a failure the provider may not have taken, whenever it happened', () => {
    expect(isHandledForRun({ outcome: 'error', httpStatus: 503, createdAt: after }, rerunAt)).toBe(
      false,
    );
  });
});

describe('hasRunStarted', () => {
  const rerunAt = new Date('2026-10-28T12:00:00Z');
  const before = new Date('2026-10-28T11:00:00Z');
  const after = new Date('2026-10-28T12:01:00Z');
  const accepted = { outcome: 'accepted', httpStatus: null } as const;

  it('counts any handled send for a job never re-run', () => {
    expect(hasRunStarted([{ ...accepted, createdAt: before }], null)).toBe(true);
    expect(hasRunStarted([], null)).toBe(false);
  });

  it('counts only sends since the last re-run, so a re-run checks its limits again', () => {
    expect(hasRunStarted([{ ...accepted, createdAt: before }], rerunAt)).toBe(false);
    expect(hasRunStarted([{ ...accepted, createdAt: after }], rerunAt)).toBe(true);
    expect(hasRunStarted([{ outcome: 'error', httpStatus: 400, createdAt: after }], rerunAt)).toBe(
      true,
    );
  });

  it('does not count a failure to be retried', () => {
    expect(hasRunStarted([{ outcome: 'error', httpStatus: 503, createdAt: after }], rerunAt)).toBe(
      false,
    );
  });
});
