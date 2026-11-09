import { and, eq, isNull, ne, or, type SQL } from 'drizzle-orm';
import { db, type DbOrTx } from '../../core/db/client';
import { FormStatus, WorkspaceStatus } from '../../core/db/codes';
import {
  saveSettingsRow,
  type SettingsSaveActor,
  type SettingsSaveStatus,
} from '../../core/db/repos/settingsRow';
import {
  forms,
  postSubmissionActionSettings as settings,
  submissions,
  workspaces,
} from '../../core/db/schema';
import type { PostSubmissionActionSubmission } from '../../core/integrations/post-submission-action/PostSubmissionActionPluginDefinition';
import type { ActionSettingRow, ActionValues } from './rules';

const ROW = {
  id: settings.id,
  formId: settings.formId,
  actionCode: settings.actionCode,
  inherit: settings.inherit,
  enabled: settings.enabled,
  options: settings.options,
  version: settings.version,
};

/** The workspace's default rows, plus the form's own rows when a form is named. */
export const findActionSettingRows = (
  executor: DbOrTx,
  workspaceId: string,
  formId: string | null,
): Promise<ActionSettingRow[]> =>
  executor
    .select(ROW)
    .from(settings)
    .where(
      and(
        eq(settings.workspaceId, workspaceId),
        formId === null
          ? isNull(settings.formId)
          : or(isNull(settings.formId), eq(settings.formId, formId)),
      ),
    );

const oneRow = (workspaceId: string, formId: string | null, code: string): SQL =>
  and(
    eq(settings.workspaceId, workspaceId),
    formId === null ? isNull(settings.formId) : eq(settings.formId, formId),
    eq(settings.actionCode, code),
  ) as SQL;

/**
 * Writes one action's settings at one scope if its row is still at `version`, creating the row at
 * version 0 first when it has none. A form row with null values inherits.
 */
export const saveActionSetting = async (input: {
  workspaceId: string;
  formId: string | null;
  code: string;
  values: ActionValues | null;
  version: number;
  actorDisplayLabel: string | null;
  audit: SettingsSaveActor;
}): Promise<SettingsSaveStatus> => {
  await db
    .insert(settings)
    .values({
      workspaceId: input.workspaceId,
      formId: input.formId,
      actionCode: input.code,
      inherit: input.formId !== null,
      createdBy: input.actorDisplayLabel,
      updatedBy: input.actorDisplayLabel,
    })
    .onConflictDoNothing();
  return saveSettingsRow(
    settings,
    oneRow(input.workspaceId, input.formId, input.code),
    {
      inherit: input.formId !== null && input.values === null,
      enabled: input.values?.enabled ?? false,
      options: input.values?.options ?? {},
      updatedBy: input.actorDisplayLabel,
      updatedAt: new Date(),
    },
    input.version,
    {
      workspaceId: input.workspaceId,
      formId: input.formId,
      groupKey: `post-submission:${input.code}`,
      actorId: input.audit.actorId,
      actorDisplayLabel: input.actorDisplayLabel,
    },
  );
};

/**
 * The submission an action runs for, while its actions may still run: the submission is not
 * deleted, its form is not deleted (an archived form still runs them), and its workspace is active.
 * Null otherwise.
 */
export const findLiveSubmission = async (
  executor: DbOrTx,
  scope: { workspaceId: string; submissionId: string },
): Promise<PostSubmissionActionSubmission | null> => {
  const [row] = await executor
    .select({
      id: submissions.id,
      formId: submissions.formId,
      formName: forms.name,
      workspaceId: submissions.workspaceId,
      workspaceName: workspaces.name,
      confirmationCode: submissions.confirmationCode,
    })
    .from(submissions)
    .innerJoin(forms, eq(forms.id, submissions.formId))
    .innerJoin(workspaces, eq(workspaces.id, submissions.workspaceId))
    .where(
      and(
        eq(submissions.id, scope.submissionId),
        eq(submissions.workspaceId, scope.workspaceId),
        isNull(submissions.deletedAt),
        isNull(forms.deletedAt),
        ne(forms.status, FormStatus.deleted),
        eq(workspaces.status, WorkspaceStatus.active),
      ),
    )
    .limit(1);
  return row ?? null;
};

/** Whether a submission's actions may still run; see findLiveSubmission. */
export const isSubmissionLive = async (
  executor: DbOrTx,
  scope: { workspaceId: string; submissionId: string },
): Promise<boolean> => (await findLiveSubmission(executor, scope)) !== null;
