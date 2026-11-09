import { describe, it, expect } from 'vitest';
import en from '@/dictionaries/en.json';
import fr from '@/dictionaries/fr.json';
import { jobTypeLabel, queuedItsActions, submissionJobTypes } from '@/src/features/jobs/jobs';
import type { Dictionary } from '@/src/types/dictionary';

describe('queuedItsActions', () => {
  const job = (type: string, childrenQueuedAt: string | null, children: unknown[] = []) =>
    ({ type, childrenQueuedAt, children }) as Parameters<typeof queuedItsActions>[0];

  it.each(['submission.submitted', 'submission.status-changed'])(
    'marks a %s job that queued its jobs, even once retention deleted them',
    (type) => {
      expect(queuedItsActions(job(type, null, [{ id: 'child-1' }]))).toBe(true);
      expect(queuedItsActions(job(type, '2026-11-08T00:00:00Z'))).toBe(true);
      expect(queuedItsActions(job(type, null))).toBe(false);
    },
  );

  it('never marks a job that queues no jobs of its own', () => {
    expect(queuedItsActions(job('submission.status-email', '2026-11-08T00:00:00Z'))).toBe(false);
  });
});

describe('job types', () => {
  it.each([
    ['en', en as Dictionary, 'Status changed', 'Status email'],
    ['fr', fr as Dictionary, 'Statut modifié', 'Courriel de statut'],
  ])('names status-changed and status email jobs in %s', (_language, dict, changed, email) => {
    expect(jobTypeLabel('submission.status-changed', dict)).toEqual({ text: changed });
    expect(jobTypeLabel('submission.status-email', dict)).toEqual({ text: email });
  });

  it("lists status changes and their emails among a submission's job types", () => {
    expect(submissionJobTypes()).toEqual(
      expect.arrayContaining(['submission.status-changed', 'submission.status-email']),
    );
  });
});
