import type { PostSubmissionActionValues } from '@/src/types/postSubmission';

/** The log action's note; empty when it has none. */
export function noteOf(values: PostSubmissionActionValues): string {
  const note = values.options.note;
  return typeof note === 'string' ? note : '';
}

/** The log action's values with this note; an empty note keeps no options. */
export function withNote(
  values: PostSubmissionActionValues,
  note: string,
): PostSubmissionActionValues {
  return { ...values, options: note ? { note } : {} };
}
