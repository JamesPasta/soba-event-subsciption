import { hasAllPermissions } from '@soba/lib';
import type { PermissionCode } from '@/src/types/permissions';

export const hasPermission = (
  userPermissions: readonly string[] | undefined,
  userPermission: PermissionCode | undefined,
) => {
  if (!userPermissions || !userPermission) {
    return undefined;
  }
  return hasAllPermissions(userPermissions, [userPermission]);
};

export {
  canContinueSubmission,
  canDeleteOwnSubmission,
  canReviseSubmission,
  canSaveDraftOnSubmission,
  canSaveSubmissionDraft,
  canStartSubmission,
  canWriteSubmission,
} from '@soba/lib';
