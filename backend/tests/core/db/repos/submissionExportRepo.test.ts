jest.mock('../../../../src/core/db/client', () => ({ db: {}, quietDb: {} }));

import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  activeExportsOf,
  afterExportSubmission,
  exportSchemaRefsWhere,
  exportSubmissionColumns,
  exportSubmissionsWhere,
  newestVersionFirst,
  ownExports,
} from '../../../../src/core/db/repos/submissionExportRepo';

const render = (condition: SQL | undefined) =>
  condition ? new PgDialect().sqlToQuery(condition) : undefined;

// Get, download, stop and the list all read through this, so a person only ever reaches their own
// exports of the form in the path.
describe('ownExports', () => {
  it("names the export job type, the path's form and the caller", () => {
    expect(render(ownExports('form-1', 'actor-1'))).toMatchObject({
      sql: '("soba"."job"."type" = $1 and "soba"."job"."form_id" = $2 and "soba"."job"."created_by" = $3)',
      params: ['submission-export', 'form-1', 'actor-1'],
    });
  });
});

// The limit counts every queued or running export of the form, whoever started it.
describe('activeExportsOf', () => {
  it("counts the form's queued and running exports only", () => {
    expect(render(activeExportsOf('form-1'))).toMatchObject({
      sql: '("soba"."job"."type" = $1 and "soba"."job"."form_id" = $2 and "soba"."job"."status" in ($3, $4))',
      params: ['submission-export', 'form-1', 'queued', 'running'],
    });
  });
});

// The field list comes from these versions only; never a draft or a deleted version.
describe('exportSchemaRefsWhere', () => {
  const COVERED =
    '"soba"."form_version"."deleted_at" is null and "soba"."form_version"."engine_schema_ref" is not null';

  it('reads the published and archived versions in the engine', () => {
    expect(render(exportSchemaRefsWhere('ws-1', 'form-1'))).toMatchObject({
      sql: `("soba"."form_version"."workspace_id" = $1 and "soba"."form_version"."form_id" = $2 and "soba"."form_version"."state" in ($3, $4) and ${COVERED})`,
      params: ['ws-1', 'form-1', 'published', 'archived'],
    });
  });

  it('narrows to the chosen version, under the same conditions', () => {
    expect(render(exportSchemaRefsWhere('ws-1', 'form-1', 'v-1'))).toMatchObject({
      sql: `("soba"."form_version"."workspace_id" = $1 and "soba"."form_version"."form_id" = $2 and "soba"."form_version"."id" = $3 and "soba"."form_version"."state" in ($4, $5) and ${COVERED})`,
      params: ['ws-1', 'form-1', 'v-1', 'published', 'archived'],
    });
  });

  it('puts the newest version first', () => {
    expect(render(newestVersionFirst)).toMatchObject({
      sql: '"soba"."form_version"."version_no" desc',
      params: [],
    });
  });
});

const LIVE =
  '("soba"."submission"."deleted_at" is null and ("soba"."form_version"."deleted_at" is null and "soba"."form"."deleted_at" is null))';
const to = new Date('2026-10-30T00:00:00.000Z');
const from = new Date('2026-10-01T00:00:00.000Z');

// An export reads the form's live submitted submissions, by when they were submitted.
describe('exportSubmissionsWhere', () => {
  it('reads every version up to the end when no version or start is given', () => {
    expect(render(exportSubmissionsWhere({ workspaceId: 'ws-1', formId: 'form-1', to }))).toEqual(
      expect.objectContaining({
        sql: `("soba"."submission"."workspace_id" = $1 and "soba"."submission"."form_id" = $2 and "soba"."submission"."workflow_state" in ($3) and "soba"."submission"."submitted_at" < $4 and ${LIVE})`,
        params: ['ws-1', 'form-1', 'submitted', to.toISOString()],
      }),
    );
  });

  it('adds the version and the start when given', () => {
    const range = { workspaceId: 'ws-1', formId: 'form-1', formVersionId: 'v-1', from, to };

    expect(render(exportSubmissionsWhere(range))).toEqual(
      expect.objectContaining({
        sql: `("soba"."submission"."workspace_id" = $1 and "soba"."submission"."form_id" = $2 and "soba"."submission"."form_version_id" = $3 and "soba"."submission"."workflow_state" in ($4) and "soba"."submission"."submitted_at" >= $5 and "soba"."submission"."submitted_at" < $6 and ${LIVE})`,
        params: ['ws-1', 'form-1', 'v-1', 'submitted', from.toISOString(), to.toISOString()],
      }),
    );
  });
});

// Username and email are the signed-in submitter's; nobody signed in leaves both blank.
describe('exportSubmissionColumns', () => {
  const ANONYMOUS =
    'case when "soba"."app_user"."id" is null or "soba"."user_identity"."id" is not null then';

  it('reads the username, else the display label, and blank for an anonymous submitter', () => {
    expect(render(exportSubmissionColumns.username)).toMatchObject({
      sql: `${ANONYMOUS} '' else coalesce("soba"."app_user"."profile"->>'preferredUsername', "soba"."app_user"."display_label", '') end`,
      params: [],
    });
  });

  it('reads the email, and blank for an anonymous submitter', () => {
    expect(render(exportSubmissionColumns.email)).toMatchObject({
      sql: `${ANONYMOUS} '' else coalesce("soba"."app_user"."profile"->>'email', '') end`,
      params: [],
    });
  });

  it('still names an anonymous submitter public', () => {
    expect(render(exportSubmissionColumns.submitter)).toMatchObject({
      sql: `${ANONYMOUS} $1 else coalesce("soba"."app_user"."display_label", '') end`,
      params: ['public'],
    });
  });
});

// The next page starts after the last row, by its time as Postgres wrote it.
describe('afterExportSubmission', () => {
  it('compares submission time and id to the cursor, the time to the microsecond', () => {
    const cursor = { submittedAt: '2026-10-02 16:05:00.123456+00', submissionId: 's-1' };

    expect(render(afterExportSubmission(cursor))).toMatchObject({
      sql: '("soba"."submission"."submitted_at", "soba"."submission"."id") > ($1::timestamptz, $2::uuid)',
      params: ['2026-10-02 16:05:00.123456+00', 's-1'],
    });
  });
});
