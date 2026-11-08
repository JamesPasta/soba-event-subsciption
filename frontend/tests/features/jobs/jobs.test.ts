import { describe, it, expect } from 'vitest';
import en from '@/dictionaries/en.json';
import fr from '@/dictionaries/fr.json';
import { jobTypeLabel, submissionJobTypes } from '@/src/features/jobs/jobs';
import type { Dictionary } from '@/src/types/dictionary';

describe('job types', () => {
  it.each([
    ['en', en as Dictionary, 'Status email'],
    ['fr', fr as Dictionary, 'Courriel de statut'],
  ])('names a status email job in %s', (_language, dict, text) => {
    expect(jobTypeLabel('submission.status-email', dict)).toEqual({ text });
  });

  it("lists status emails among a submission's job types", () => {
    expect(submissionJobTypes()).toContain('submission.status-email');
  });
});
