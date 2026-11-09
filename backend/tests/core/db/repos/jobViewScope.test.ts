jest.mock('../../../../src/core/db/client', () => ({ db: {}, quietDb: {} }));

import { eq, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { scoped, scopeWhere } from '../../../../src/core/db/repos/jobViewRepo';
import { jobs } from '../../../../src/core/db/schema';

const render = (condition: SQL | undefined) =>
  condition ? new PgDialect().sqlToQuery(condition) : undefined;

const STARTED_BY_A_SUBMISSION = '"soba"."job"."submission_id" is not null';

// Every job read and write in the repo goes through these, so a staff reader's query always names
// their form or workspace.
describe('scopeWhere', () => {
  it('limits a form scope to the jobs its submissions started', () => {
    expect(render(scopeWhere({ kind: 'form', formId: 'f1' }))).toMatchObject({
      sql: `("soba"."job"."form_id" = $1 and ${STARTED_BY_A_SUBMISSION})`,
      params: ['f1'],
    });
  });

  it('limits a workspace scope to the jobs its submissions started', () => {
    expect(render(scopeWhere({ kind: 'workspace', workspaceId: 'w1' }))).toMatchObject({
      sql: `("soba"."job"."workspace_id" = $1 and ${STARTED_BY_A_SUBMISSION})`,
      params: ['w1'],
    });
  });

  it('adds nothing for every job', () => {
    expect(scopeWhere({ kind: 'all' })).toBeUndefined();
  });

  it('refuses a scope with no id rather than read every job', () => {
    expect(() => scopeWhere({ kind: 'form', formId: '' })).toThrow('A form job scope needs its id');
    expect(() => scopeWhere({ kind: 'workspace', workspaceId: '' })).toThrow(
      'A workspace job scope needs its id',
    );
  });
});

describe('scoped', () => {
  it("keeps the scope's condition beside the query's own", () => {
    expect(render(scoped({ kind: 'form', formId: 'f1' }, eq(jobs.id, 'j1')))).toMatchObject({
      sql: `(("soba"."job"."form_id" = $1 and ${STARTED_BY_A_SUBMISSION}) and "soba"."job"."id" = $2)`,
      params: ['f1', 'j1'],
    });
  });
});
