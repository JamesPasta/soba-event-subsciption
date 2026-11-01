import { describe, it, expect } from 'vitest';
import { JOB_STATUSES, SUBMISSION_EXPORT_END_REASONS, SUBMISSION_EXPORT_STATUSES } from '@soba/lib';
import en from '@/dictionaries/en.json';
import fr from '@/dictionaries/fr.json';

/** Each key path in a dictionary section, with its text. */
const entries = (node: unknown, path = ''): [string, string][] =>
  typeof node === 'string'
    ? [[path, node]]
    : Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
        entries(value, path ? `${path}.${key}` : key),
      );

const keys = (section: unknown) => entries(section).map(([path]) => path);
const allFilled = (section: unknown) =>
  entries(section).every(([, text]) => text.trim().length > 0);

// Same for the exports page, whose statuses and end reasons come from the lib's lists.
describe('Submission export copy', () => {
  it('has the same keys in English and French, all filled', () => {
    expect(keys(fr.submission.export)).toEqual(keys(en.submission.export));
    expect(allFilled(en.submission.export)).toBe(true);
    expect(allFilled(fr.submission.export)).toBe(true);
  });

  it.each([
    ['en', en],
    ['fr', fr],
  ])('%s names every export status and end reason', (_language, dict) => {
    expect(Object.keys(dict.submission.export.statuses).sort()).toEqual(
      [...SUBMISSION_EXPORT_STATUSES].sort(),
    );
    expect(Object.keys(dict.submission.export.endReasons).sort()).toEqual(
      [...SUBMISSION_EXPORT_END_REASONS].sort(),
    );
  });
});

// The type checks the French dictionary against nothing, so a missing French key shows in the page
// as undefined. These hold the Jobs pages' copy in both languages: the text every reader shares,
// and the Administration tab's own.
describe('Jobs copy', () => {
  it.each([
    ['shared', en.jobs, fr.jobs],
    ['administration', en.admin.jobs, fr.admin.jobs],
  ])('%s text has the same keys in English and French', (_section, english, french) => {
    expect(keys(french)).toEqual(keys(english));
  });

  it.each([
    ['en', en],
    ['fr', fr],
  ])('%s has text for every key and every job status', (_language, dict) => {
    expect(allFilled(dict.jobs)).toBe(true);
    expect(allFilled(dict.admin.jobs)).toBe(true);
    expect(Object.keys(dict.jobs.statuses).sort()).toEqual([...JOB_STATUSES].sort());
  });

  it.each([
    ['en', en.jobs],
    ['fr', fr.jobs],
  ])('%s keeps the placeholders the pages fill in', (_language, section) => {
    expect(section.attemptsValue).toContain('{attempts}');
    expect(section.attemptsValue).toContain('{max}');
    expect(section.viewLabel).toContain('{type}');
    expect(section.viewLabel).toContain('{created}');
    expect(section.detail.byValue).toContain('{at}');
    expect(section.detail.byValue).toContain('{by}');
    expect(section.detail.rerunsValue).toContain('{count}');
    expect(section.detail.rerunsValue).toContain('{at}');
    expect(section.detail.rerunsValue).toContain('{by}');
    expect(section.detail.rerunEmails).toContain('{count}');
    expect(section.detail.refused).toContain('{reason}');
  });
});
