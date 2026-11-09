import { describe, it, expect } from 'vitest';
import en from '@/dictionaries/en.json';
import fr from '@/dictionaries/fr.json';
import { jobTypeLabel, submissionJobTypes } from '@/src/features/jobs/jobs';
import type { Dictionary } from '@/src/types/dictionary';

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
