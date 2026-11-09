import type { Dictionary } from '@/src/types/dictionary';
import type { SubmissionListItem } from '@/src/types/submissions';

/** Names the submission by its confirmation code, or by when it was last changed until it has one. */
export function submissionDeleteMessage(
  dictSub: Dictionary['submission'],
  sub: SubmissionListItem,
  formatLongDate: (date?: string | null) => string,
): string {
  const message = sub.confirmationCode
    ? dictSub.deleteMessage.replace('{confirmation}', sub.confirmationCode)
    : dictSub.deleteDraftMessage.replace('{updated}', formatLongDate(sub.updatedAt));
  return message.replace('{submitter}', sub.createdBy || dictSub.anon);
}
