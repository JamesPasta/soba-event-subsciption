import { and, eq } from 'drizzle-orm';
import { db, type DbOrTx } from '../client';
import { submissionParticipants } from '../schema';
import {
  SubmissionParticipantRole,
  SubmissionParticipantStatus,
  type SubmissionParticipantRoleCode,
} from '../codes';

const hasActiveGrant = async (
  submissionId: string,
  userId: string,
  role?: SubmissionParticipantRoleCode,
  executor: DbOrTx = db,
): Promise<boolean> => {
  const rows = await executor
    .select({ id: submissionParticipants.id })
    .from(submissionParticipants)
    .where(
      and(
        eq(submissionParticipants.submissionId, submissionId),
        eq(submissionParticipants.userId, userId),
        eq(submissionParticipants.status, SubmissionParticipantStatus.active),
        role ? eq(submissionParticipants.role, role) : undefined,
      ),
    )
    .limit(1);
  return rows.length > 0;
};

/** Whether the user holds an active grant (any role) on the submission. */
export const isActiveParticipant = (submissionId: string, userId: string): Promise<boolean> =>
  hasActiveGrant(submissionId, userId);

/** Whether the user holds an active owner grant on the submission. */
export const isActiveOwner = (
  submissionId: string,
  userId: string,
  executor: DbOrTx = db,
): Promise<boolean> =>
  hasActiveGrant(submissionId, userId, SubmissionParticipantRole.owner, executor);
