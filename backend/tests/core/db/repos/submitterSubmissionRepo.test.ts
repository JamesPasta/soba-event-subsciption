const selectMock = jest.fn();

jest.mock('../../../../src/core/db/client', () => ({
  db: {
    select: (...args: unknown[]) => selectMock(...args),
  },
}));

// A query built when the module loads would run before the env and pool are set up.
describe('submitterSubmissionRepo', () => {
  it('builds no query when it is imported', async () => {
    await import('../../../../src/core/db/repos/submitterSubmissionRepo');
    expect(selectMock).not.toHaveBeenCalled();
  });
});
