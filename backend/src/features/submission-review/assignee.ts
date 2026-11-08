import { hasAllPermissions, Permissions } from '@soba/lib';
import { resolveFormPermissions } from '../../core/db/repos/formAccessRepo';
import { listReviewUsers } from '../../core/db/repos/submissionReviewRepo';

/** Whether a user can be assigned the form's submissions: active and holding submission_review. */
export const canReviewForm = async (
  workspaceId: string,
  formId: string,
  userId: string,
): Promise<boolean> => {
  const [permissions, activeUsers] = await Promise.all([
    resolveFormPermissions(userId, workspaceId, formId),
    listReviewUsers([userId]),
  ]);
  return activeUsers.length > 0 && hasAllPermissions(permissions, [Permissions.submission_review]);
};
