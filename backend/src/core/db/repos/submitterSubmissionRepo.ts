import { and, eq } from 'drizzle-orm';
import {
  submitterReviewLabelOf,
  type SubmissionReviewStatus,
  type SubmissionReviseFacts,
} from '@soba/lib';
import { db, type DbOrTx } from '../client';
import { PUBLIC_PROVIDER_CODE, SubmissionParticipantStatus } from '../codes';
import {
  formVersions,
  forms,
  submissionParticipants,
  submissions,
  submissionStatuses,
  workspaces,
} from '../schema';
import { liveSubmission } from './liveRows';
import type { SubmissionDetailRow } from './submissionRepo';
import { formFacts, type SubmitterFormListRow } from './submitterFormRepo';

/** A live submission as the submit routes read it: its detail, and what the engine reads need. */
export interface SubmitterSubmissionRow extends SubmissionDetailRow {
  workspaceId: string;
  engineSubmissionRef: string | null;
  /** The submission's own form version in the engine. */
  engineSchemaRef: string | null;
  formEngineCode: string;
  /** The current review status change; null before it is submitted. */
  statusId: string | null;
}

/**
 * A submission, the caller's standing on it and where its review stands, and its form with its
 * facts for the caller.
 */
export interface SubmitterSubmission {
  submission: SubmitterSubmissionRow;
  access: SubmissionReviseFacts;
  form: SubmitterFormListRow;
}

/**
 * Everything the submit routes decide on, in one statement: the submission, the caller's active
 * grant, and its form with its facts. Null when the submission, its form or its version is
 * deleted. The public user's grant counts; its form permissions are not read, as it belongs to no
 * workspace.
 */
export const findSubmitterSubmission = async (
  input: { submissionId: string; actorId: string; idpCode?: string | null },
  executor: DbOrTx = db,
): Promise<SubmitterSubmission | null> => {
  const userId = input.idpCode === PUBLIC_PROVIDER_CODE ? null : input.actorId;
  const facts = formFacts(userId, {
    formIds: db
      .select({ formId: submissions.formId })
      .from(submissions)
      .where(eq(submissions.id, input.submissionId)),
  });
  const [row] = await facts
    .join(
      executor
        .select({
          id: submissions.id,
          workspaceId: submissions.workspaceId,
          formId: submissions.formId,
          form: { name: forms.name },
          formVersionId: submissions.formVersionId,
          formVersion: { versionNo: formVersions.versionNo },
          headRevisionId: submissions.headRevisionId,
          currentRevisionNo: submissions.currentRevisionNo,
          workflowState: submissions.workflowState,
          engineSyncStatus: submissions.engineSyncStatus,
          submittedAt: submissions.submittedAt,
          createdAt: submissions.createdAt,
          updatedAt: submissions.updatedAt,
          createdBy: submissions.createdBy,
          submittedBy: submissions.submittedBy,
          confirmationCode: submissions.confirmationCode,
          engineSubmissionRef: submissions.engineSubmissionRef,
          engineSchemaRef: formVersions.engineSchemaRef,
          formEngineCode: forms.formEngineCode,
          statusId: submissions.statusId,
          reviewStatus: submissionStatuses.status,
          workspaceName: workspaces.name,
          role: submissionParticipants.role,
          ...facts.columns,
        })
        .from(submissions)
        .innerJoin(forms, eq(forms.id, submissions.formId))
        .innerJoin(workspaces, eq(workspaces.id, submissions.workspaceId))
        .innerJoin(formVersions, eq(formVersions.id, submissions.formVersionId))
        .leftJoin(submissionStatuses, eq(submissionStatuses.id, submissions.statusId))
        .leftJoin(
          submissionParticipants,
          and(
            eq(submissionParticipants.submissionId, submissions.id),
            eq(submissionParticipants.userId, input.actorId),
            eq(submissionParticipants.status, SubmissionParticipantStatus.active),
          ),
        )
        .$dynamic(),
    )
    .where(and(eq(submissions.id, input.submissionId), liveSubmission))
    .limit(1);
  if (!row) return null;

  const {
    workspaceName,
    role,
    publishedVersionId,
    permissions,
    audienceMode,
    audienceIdps,
    allowSubmitterDrafts,
    allowSubmitterRevision,
    reviewStatus,
    ...submission
  } = row;
  return {
    submission,
    access: {
      role,
      workflowState: submission.workflowState,
      reviewStatus: submitterReviewLabelOf(reviewStatus as SubmissionReviewStatus | null),
    },
    form: {
      id: submission.formId,
      name: submission.form.name,
      workspaceId: submission.workspaceId,
      workspaceName,
      publishedVersionId,
      permissions,
      audienceMode,
      audienceIdps,
      allowSubmitterDrafts,
      allowSubmitterRevision,
    },
  };
};
