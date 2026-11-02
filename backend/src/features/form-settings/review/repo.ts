import { and, eq, type SQL } from 'drizzle-orm';
import { REVIEW_SETTINGS_KEY, type ReviewSettings, type WorkspaceSettings } from '@soba/lib';
import { db, type DbOrTx } from '../../../core/db/client';
import { formReviewSettings, workspaceReviewSettings } from '../../../core/db/schema';
import type { InheritableRow } from '../inheritable';
import type { FormSettingsRowInput } from '../types';
import {
  saveSettingsRow,
  type SettingsSaveActor,
  type SettingsSaveStatus,
} from '../../../core/db/repos/settingsRow';

/** A form's review settings row read with its workspace's. */
export interface FormReviewSettingsRow extends InheritableRow<ReviewSettings> {
  workspace: ReviewSettings;
}

/** Creates a new workspace's review settings, every flag at its database default. */
export const createWorkspaceReviewSettings = async (
  input: { workspaceId: string; actorDisplayLabel: string | null },
  executor: DbOrTx,
): Promise<void> => {
  await executor.insert(workspaceReviewSettings).values({
    workspaceId: input.workspaceId,
    createdBy: input.actorDisplayLabel,
    updatedBy: input.actorDisplayLabel,
  });
};

/** Creates a new form's review settings, inheriting its workspace's. */
export const createReviewSettings = async (
  input: FormSettingsRowInput,
  executor: DbOrTx,
): Promise<void> => {
  await executor.insert(formReviewSettings).values({
    workspaceId: input.workspaceId,
    formId: input.formId,
    createdBy: input.actorDisplayLabel,
    updatedBy: input.actorDisplayLabel,
  });
};

/** A workspace's review settings and their version, or null when the workspace has no row. */
export const findWorkspaceReviewSettings = async (
  workspaceId: string,
): Promise<WorkspaceSettings<ReviewSettings> | null> => {
  const rows = await db
    .select({
      allowStatusUpdates: workspaceReviewSettings.allowStatusUpdates,
      allowSubmitterRevision: workspaceReviewSettings.allowSubmitterRevision,
      version: workspaceReviewSettings.version,
    })
    .from(workspaceReviewSettings)
    .where(eq(workspaceReviewSettings.workspaceId, workspaceId))
    .limit(1);
  const row = rows[0];
  return row
    ? {
        values: {
          allowStatusUpdates: row.allowStatusUpdates,
          allowSubmitterRevision: row.allowSubmitterRevision,
        },
        version: row.version,
      }
    : null;
};

/** Writes a workspace's review settings if its row is still at `version`. */
export const updateWorkspaceReviewSettings = (input: {
  workspaceId: string;
  settings: ReviewSettings;
  version?: number;
  actorDisplayLabel: string | null;
  audit?: SettingsSaveActor;
}): Promise<SettingsSaveStatus> =>
  saveSettingsRow(
    workspaceReviewSettings,
    eq(workspaceReviewSettings.workspaceId, input.workspaceId),
    {
      allowStatusUpdates: input.settings.allowStatusUpdates,
      allowSubmitterRevision: input.settings.allowSubmitterRevision,
      updatedBy: input.actorDisplayLabel,
      updatedAt: new Date(),
    },
    input.version,
    input.audit && {
      workspaceId: input.workspaceId,
      formId: null,
      groupKey: REVIEW_SETTINGS_KEY,
      actorId: input.audit.actorId,
      actorDisplayLabel: input.actorDisplayLabel,
    },
  );

/** A form's review settings with its workspace's, or null when either row is missing. */
export const findReviewSettings = async (
  workspaceId: string,
  formId: string,
): Promise<FormReviewSettingsRow | null> => {
  const rows = await db
    .select({
      inherit: formReviewSettings.inherit,
      allowStatusUpdates: formReviewSettings.allowStatusUpdates,
      allowSubmitterRevision: formReviewSettings.allowSubmitterRevision,
      version: formReviewSettings.version,
      workspaceAllowStatusUpdates: workspaceReviewSettings.allowStatusUpdates,
      workspaceAllowSubmitterRevision: workspaceReviewSettings.allowSubmitterRevision,
    })
    .from(formReviewSettings)
    .innerJoin(
      workspaceReviewSettings,
      eq(workspaceReviewSettings.workspaceId, formReviewSettings.workspaceId),
    )
    .where(
      and(eq(formReviewSettings.workspaceId, workspaceId), eq(formReviewSettings.formId, formId)),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  // The CHECK constraint sets both flags together, so a null either one means the form inherits.
  const own =
    row.inherit || row.allowStatusUpdates == null || row.allowSubmitterRevision == null
      ? null
      : {
          allowStatusUpdates: row.allowStatusUpdates,
          allowSubmitterRevision: row.allowSubmitterRevision,
        };
  return {
    inherit: row.inherit,
    own,
    workspace: {
      allowStatusUpdates: row.workspaceAllowStatusUpdates,
      allowSubmitterRevision: row.workspaceAllowSubmitterRevision,
    },
    version: row.version,
  };
};

/**
 * Writes a form's review settings if its row is still at `version`. Null settings inherit the
 * workspace's and clear the form's own.
 */
export const updateReviewSettings = (input: {
  workspaceId: string;
  formId: string;
  settings: ReviewSettings | null;
  version?: number;
  actorDisplayLabel: string | null;
  audit?: SettingsSaveActor;
}): Promise<SettingsSaveStatus> =>
  saveSettingsRow(
    formReviewSettings,
    and(
      eq(formReviewSettings.workspaceId, input.workspaceId),
      eq(formReviewSettings.formId, input.formId),
    ) as SQL,
    {
      inherit: input.settings == null,
      allowStatusUpdates: input.settings?.allowStatusUpdates ?? null,
      allowSubmitterRevision: input.settings?.allowSubmitterRevision ?? null,
      updatedBy: input.actorDisplayLabel,
      updatedAt: new Date(),
    },
    input.version,
    input.audit && {
      workspaceId: input.workspaceId,
      formId: input.formId,
      groupKey: REVIEW_SETTINGS_KEY,
      actorId: input.audit.actorId,
      actorDisplayLabel: input.actorDisplayLabel,
    },
  );

/** The review settings a form uses, found by the form alone; all off when it has none. */
export const findEffectiveReviewSettingsOfForm = async (
  formId: string,
): Promise<ReviewSettings> => {
  const [form] = await db
    .select({ workspaceId: formReviewSettings.workspaceId })
    .from(formReviewSettings)
    .where(eq(formReviewSettings.formId, formId))
    .limit(1);
  return form
    ? findEffectiveReviewSettings(form.workspaceId, formId)
    : { allowStatusUpdates: false, allowSubmitterRevision: false };
};

/** The review settings that apply to a form: its own, else its workspace's; off without a row. */
export const findEffectiveReviewSettings = async (
  workspaceId: string,
  formId: string,
): Promise<ReviewSettings> => {
  const row = await findReviewSettings(workspaceId, formId);
  return row?.own ?? row?.workspace ?? { allowStatusUpdates: false, allowSubmitterRevision: false };
};
