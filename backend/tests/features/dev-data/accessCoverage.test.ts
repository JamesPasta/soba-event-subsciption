import {
  compareTextForSort,
  nextSubmissionStatuses,
  SORT_LOCALES,
  SubmissionReviewStatuses,
  type SubmissionReviewStatus,
} from '@soba/lib';
import { buildPlan, DEV_SUBJECT_PREFIX } from '../../../src/features/dev-data/plan';
import {
  ADMIN,
  ANONYMOUS,
  buildCoveragePlan,
  COVERAGE_FORM_KEYS,
  COVERAGE_PREFIX,
  COVERAGE_SUBMISSION_KEYS,
} from '../../../src/features/dev-data/access/plan';
import {
  DESIGN_CHECKS,
  DESIGN_EXPECTATIONS,
  expectedOf,
  FORM_EXPECTATIONS,
  mismatchesOf,
  SUBMISSION_EXPECTATIONS,
  WORKSPACE_EXPECTATIONS,
} from '../../../src/features/dev-data/access/expectations';

describe('dev data access coverage plan', () => {
  const plan = buildCoveragePlan();
  const forms = plan.workspaces.flatMap((w) => w.forms);

  it('gives personas generated subjects, so the owner guard refuses them', () => {
    for (const persona of plan.personas) {
      expect(persona.subject.startsWith(DEV_SUBJECT_PREFIX)).toBe(true);
    }
    const labels = new Set(plan.personas.map((p) => p.displayLabel));
    expect(labels.size).toBe(plan.personas.length);
  });

  it('plans each form and submission key exactly once', () => {
    expect(forms.map((f) => f.key).sort()).toEqual([...COVERAGE_FORM_KEYS].sort());
    expect(plan.submissions.map((s) => s.key).sort()).toEqual([...COVERAGE_SUBMISSION_KEYS].sort());
  });

  it('only overrides with personas seated in the same workspace', () => {
    for (const workspace of plan.workspaces) {
      const seated = new Set<string>(workspace.seats.map((s) => s.persona));
      for (const form of workspace.forms) {
        for (const persona of form.groupOverride?.members ?? []) {
          expect(seated.has(persona)).toBe(true);
        }
      }
    }
  });

  it('only overrides a named group a seat in the same workspace creates', () => {
    for (const workspace of plan.workspaces) {
      const named = new Set(
        workspace.seats.flatMap((s) => (s.group && 'name' in s.group ? [s.group.name] : [])),
      );
      for (const form of workspace.forms) {
        const group = form.groupOverride?.group;
        if (group && 'name' in group) expect(named.has(group.name)).toBe(true);
      }
    }
  });

  it('only submits to a published form', () => {
    const published = new Set(forms.filter((f) => f.published).map((f) => f.key));
    for (const submission of plan.submissions) {
      expect(published.has(submission.form)).toBe(true);
    }
  });

  // The generator writes status changes through the same rule the API applies.
  it('only changes the status of a submitted submission, by moves the rule allows', () => {
    for (const submission of plan.submissions) {
      const changes = submission.statusChanges ?? [];
      if (changes.length === 0) continue;
      expect(submission.events).toContain('submitted');
      let current: SubmissionReviewStatus = SubmissionReviewStatuses.submitted;
      for (const change of changes) {
        expect(nextSubmissionStatuses(current)).toContain(change.status);
        expect(change.assignee !== undefined).toBe(
          change.status === SubmissionReviewStatuses.assigned,
        );
        current = change.status;
      }
    }
  });

  // The server refuses a revision of an anonymous submission: no one could be asked to revise it.
  it('only sends a signed-in submitter back to revise', () => {
    const revised = plan.submissions.filter((submission) =>
      submission.statusChanges?.some((c) => c.status === SubmissionReviewStatuses.revising),
    );
    expect(revised.length).toBeGreaterThan(0);
    for (const submission of revised) expect(submission.by).not.toBe(ANONYMOUS);
  });

  // The admin owns every coverage workspace, so holds review in each without a seat.
  it("only assigns to a persona seated in the submission's workspace", () => {
    const workspaceOf = new Map(
      plan.workspaces.flatMap((w) => w.forms.map((f) => [f.key, w] as const)),
    );
    for (const submission of plan.submissions) {
      const seated = new Set<string>(workspaceOf.get(submission.form)!.seats.map((s) => s.persona));
      for (const change of submission.statusChanges ?? []) {
        if (change.assignee && change.assignee !== ADMIN) {
          expect(seated.has(change.assignee)).toBe(true);
        }
      }
    }
  });

  it.each(SORT_LOCALES)('names sort after every generated name in %s', (locale) => {
    const bulk = buildPlan('large').workspaces.flatMap((w) => [
      w.name,
      ...w.forms.map((f) => f.name),
    ]);
    const coverage = [...plan.workspaces.map((w) => w.name), ...forms.map((f) => f.name)];
    for (const name of coverage) {
      expect(name.startsWith(COVERAGE_PREFIX)).toBe(true);
      for (const other of bulk) {
        expect(
          compareTextForSort(name, other, 'asc', locale, { linguistic: true }),
        ).toBeGreaterThan(0);
      }
    }
  });
});

describe('dev data access coverage expectations', () => {
  it.each(COVERAGE_FORM_KEYS)('%s: only a persona who can start can save a draft', (key) => {
    const { start, draft } = FORM_EXPECTATIONS[key];
    expect(draft.filter((persona) => !start.includes(persona))).toEqual([]);
  });

  it.each(COVERAGE_SUBMISSION_KEYS)('%s: every listing, write or delete is by a reader', (key) => {
    const { mine, read, write, render, delete: remove } = SUBMISSION_EXPECTATIONS[key];
    expect(
      [...mine, ...write, ...render, ...remove].filter((persona) => !read.includes(persona)),
    ).toEqual([]);
  });

  it.each(COVERAGE_SUBMISSION_KEYS)('%s: only a writer uploads a file', (key) => {
    const { write, upload } = SUBMISSION_EXPECTATIONS[key];
    expect(upload.filter((persona) => !write.includes(persona))).toEqual([]);
  });

  it.each(COVERAGE_FORM_KEYS)('%s: the designer lists only forms the persona can read', (key) => {
    const { designListed, designRead } = DESIGN_EXPECTATIONS[key];
    expect(designListed.filter((persona) => !designRead.includes(persona))).toEqual([]);
  });

  it.each(COVERAGE_FORM_KEYS)('%s: only a reader of the form reads its staff templates', (key) => {
    const { staffTemplates, designRead } = DESIGN_EXPECTATIONS[key];
    expect(staffTemplates.filter((persona) => !designRead.includes(persona))).toEqual([]);
  });

  it.each(COVERAGE_FORM_KEYS)('%s: only a submission reader prints with an upload', (key) => {
    const { printUpload, submissionsRead } = DESIGN_EXPECTATIONS[key];
    expect(printUpload.filter((persona) => !submissionsRead.includes(persona))).toEqual([]);
  });

  it('gives the anonymous caller no design or workspace access', () => {
    for (const key of COVERAGE_FORM_KEYS) {
      for (const check of DESIGN_CHECKS) {
        expect(DESIGN_EXPECTATIONS[key][check]).not.toContain(ANONYMOUS);
      }
    }
    for (const expectation of Object.values(WORKSPACE_EXPECTATIONS)) {
      expect(expectation.peopleRead).not.toContain(ANONYMOUS);
    }
  });

  it('never lists anything for, or lets delete, the anonymous caller', () => {
    for (const key of COVERAGE_FORM_KEYS) {
      expect(FORM_EXPECTATIONS[key].listed).not.toContain(ANONYMOUS);
    }
    for (const key of COVERAGE_SUBMISSION_KEYS) {
      expect(SUBMISSION_EXPECTATIONS[key].mine).not.toContain(ANONYMOUS);
      expect(SUBMISSION_EXPECTATIONS[key].delete).not.toContain(ANONYMOUS);
    }
  });

  it('reads one persona out of the table, per check', () => {
    const table = { read: ['outsider' as const], write: [] };
    expect(expectedOf(['read', 'write'], table, 'outsider')).toEqual({ read: true, write: false });
    expect(expectedOf(['read', 'write'], table, 'owner')).toEqual({ read: false, write: false });
  });

  it('reports only the cells that differ, with the expected answer', () => {
    const results = [
      {
        persona: 'outsider' as const,
        caseKey: 'outsiderDraft',
        actual: { read: true, write: true },
        expected: { read: true, write: false },
      },
      {
        persona: 'owner' as const,
        caseKey: 'ownerDraft',
        actual: { read: true, write: true },
        expected: { read: true, write: true },
      },
    ];
    expect(mismatchesOf(results)).toEqual([
      { persona: 'outsider', caseKey: 'outsiderDraft', check: 'write', expected: false },
    ]);
  });
});
