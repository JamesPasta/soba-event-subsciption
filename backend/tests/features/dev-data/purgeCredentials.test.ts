jest.mock('../../../src/core/db/client', () => {
  const { drizzle } = jest.requireActual('drizzle-orm/node-postgres');
  const client = { query: jest.fn(async () => ({ rows: [], rowCount: 1 })) };
  return { db: drizzle(client) };
});
jest.mock('../../../src/features/dev-data/runs', () => ({
  listOpenRuns: jest.fn(async () => []),
  idsFromRuns: jest.fn(() => ({
    workspaceIds: ['01900000-0000-7000-8000-000000000001'],
    userIds: [],
  })),
  markRunsPurged: jest.fn(async () => undefined),
}));
import { db } from '../../../src/core/db/client';
import { purge } from '../../../src/features/dev-data/purge';

// Compile real Drizzle queries against a fake client so deletion scope and FK order are checked.
describe('dev-data credential purge', () => {
  it("deletes only the targeted workspaces' keys, children before keys before forms", async () => {
    const query = jest.mocked(db.$client.query);
    query.mockClear();
    const result = await purge();
    const calls = query.mock.calls.map((args) => {
      const config = args[0] as unknown as string | { text: string };
      return { sql: typeof config === 'string' ? config : config.text, params: args[1] };
    });
    const deleteOf = (table: string) =>
      calls.findIndex(({ sql }) => sql.startsWith(`delete from "soba"."${table}"`));
    const order = [
      'credential_audit',
      'credential_type_assignment',
      'workspace_credential',
      'form',
      'workspace',
    ].map(deleteOf);
    expect(order.every((index) => index > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    for (const index of order.slice(0, 3)) {
      expect(calls[index].sql).toContain('"workspace_id" in ($1)');
      expect(calls[index].params).toEqual(['01900000-0000-7000-8000-000000000001']);
    }
    expect(result.rowsDeleted.credential_type_assignment).toBe(1);
    expect(result.rowsDeleted.credential_audit).toBe(1);
    expect(result.rowsDeleted.workspace_credential).toBe(1);
  });
});
