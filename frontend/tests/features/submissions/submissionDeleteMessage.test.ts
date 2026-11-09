import { describe, it, expect } from 'vitest';
import en from '@/dictionaries/en.json';
import { submissionDeleteMessage } from '@/src/features/submissions/submissionDeleteMessage';
import type { SubmissionListItem } from '@/src/types/submissions';

const formatLongDate = (date?: string | null) => `formatted ${date}`;
const submission = (fields: Partial<SubmissionListItem>) => fields as SubmissionListItem;

describe('submissionDeleteMessage', () => {
  it('names a submitted submission by its confirmation code and submitter', () => {
    const message = submissionDeleteMessage(
      en.submission,
      submission({ confirmationCode: 'K7M2Q9XA', createdBy: 'Ada Lovelace' }),
      formatLongDate,
    );

    expect(message).toBe(
      'Submission K7M2Q9XA from Ada Lovelace will be deleted. This cannot be undone.',
    );
  });

  it('names an unsubmitted one by when it was last changed', () => {
    const message = submissionDeleteMessage(
      en.submission,
      submission({ confirmationCode: null, createdBy: 'Ada Lovelace', updatedAt: '2026-01-02' }),
      formatLongDate,
    );

    expect(message).toContain('last updated formatted 2026-01-02');
    expect(message).toContain('Ada Lovelace');
  });

  it('calls a submitter with no name anonymous', () => {
    const message = submissionDeleteMessage(
      en.submission,
      submission({ confirmationCode: 'K7M2Q9XA', createdBy: null }),
      formatLongDate,
    );

    expect(message).toContain('from Anonymous');
  });
});
