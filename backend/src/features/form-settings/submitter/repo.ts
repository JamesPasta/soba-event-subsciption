import { and, eq, type SQL } from 'drizzle-orm';
import { SUBMITTER_SETTINGS_KEY, type SubmitterSettings, type WorkspaceSettings } from '@soba/lib';
import { db, type DbOrTx } from '../../../core/db/client';
import { formSubmitterSettings, workspaceSubmitterSettings } from '../../../core/db/schema';
import type { InheritableRow } from '../inheritable';
import type { FormSettingsRowInput } from '../types';
import {
  saveSettingsRow,
  type SettingsSaveActor,
  type SettingsSaveStatus,
} from '../../../core/db/repos/settingsRow';

/** A form's submitter settings row read with its workspace's. */
export interface FormSubmitterSettingsRow extends InheritableRow<SubmitterSettings> {
  workspace: SubmitterSettings;
}

/** Creates a new workspace's submitter settings, every flag at its database default. */
export const createWorkspaceSubmitterSettings = async (
  input: { workspaceId: string; actorDisplayLabel: string | null },
  executor: DbOrTx,
): Promise<void> => {
  await executor.insert(workspaceSubmitterSettings).values({
    workspaceId: input.workspaceId,
    createdBy: input.actorDisplayLabel,
    updatedBy: input.actorDisplayLabel,
  });
};

/** Creates a new form's submitter settings, inheriting its workspace's. */
export const createSubmitterSettings = async (
  input: FormSettingsRowInput,
  executor: DbOrTx,
): Promise<void> => {
  await executor.insert(formSubmitterSettings).values({
    workspaceId: input.workspaceId,
    formId: input.formId,
    createdBy: input.actorDisplayLabel,
    updatedBy: input.actorDisplayLabel,
  });
};

/** A workspace's submitter settings and their version, or null when the workspace has no row. */
export const findWorkspaceSubmitterSettings = async (
  workspaceId: string,
): Promise<WorkspaceSettings<SubmitterSettings> | null> => {
  const rows = await db
    .select({
      allowSubmitterDrafts: workspaceSubmitterSettings.allowSubmitterDrafts,
      version: workspaceSubmitterSettings.version,
    })
    .from(workspaceSubmitterSettings)
    .where(eq(workspaceSubmitterSettings.workspaceId, workspaceId))
    .limit(1);
  const row = rows[0];
  return row
    ? { values: { allowSubmitterDrafts: row.allowSubmitterDrafts }, version: row.version }
    : null;
};

/** Writes a workspace's submitter settings if its row is still at `version`. */
export const updateWorkspaceSubmitterSettings = (input: {
  workspaceId: string;
  settings: SubmitterSettings;
  version?: number;
  actorDisplayLabel: string | null;
  audit?: SettingsSaveActor;
}): Promise<SettingsSaveStatus> =>
  saveSettingsRow(
    workspaceSubmitterSettings,
    eq(workspaceSubmitterSettings.workspaceId, input.workspaceId),
    {
      allowSubmitterDrafts: input.settings.allowSubmitterDrafts,
      updatedBy: input.actorDisplayLabel,
      updatedAt: new Date(),
    },
    input.version,
    input.audit && {
      workspaceId: input.workspaceId,
      formId: null,
      groupKey: SUBMITTER_SETTINGS_KEY,
      actorId: input.audit.actorId,
      actorDisplayLabel: input.actorDisplayLabel,
    },
  );

/** A form's submitter settings with its workspace's, or null when either row is missing. */
export const findSubmitterSettings = async (
  workspaceId: string,
  formId: string,
): Promise<FormSubmitterSettingsRow | null> => {
  const rows = await db
    .select({
      inherit: formSubmitterSettings.inherit,
      allowSubmitterDrafts: formSubmitterSettings.allowSubmitterDrafts,
      version: formSubmitterSettings.version,
      workspaceAllowSubmitterDrafts: workspaceSubmitterSettings.allowSubmitterDrafts,
    })
    .from(formSubmitterSettings)
    .innerJoin(
      workspaceSubmitterSettings,
      eq(workspaceSubmitterSettings.workspaceId, formSubmitterSettings.workspaceId),
    )
    .where(
      and(
        eq(formSubmitterSettings.workspaceId, workspaceId),
        eq(formSubmitterSettings.formId, formId),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    inherit: row.inherit,
    own:
      row.inherit || row.allowSubmitterDrafts == null
        ? null
        : { allowSubmitterDrafts: row.allowSubmitterDrafts },
    workspace: { allowSubmitterDrafts: row.workspaceAllowSubmitterDrafts },
    version: row.version,
  };
};

/**
 * Writes a form's submitter settings if its row is still at `version`. Null settings inherit the
 * workspace's and clear the form's own.
 */
export const updateSubmitterSettings = (input: {
  workspaceId: string;
  formId: string;
  settings: SubmitterSettings | null;
  version?: number;
  actorDisplayLabel: string | null;
  audit?: SettingsSaveActor;
}): Promise<SettingsSaveStatus> =>
  saveSettingsRow(
    formSubmitterSettings,
    and(
      eq(formSubmitterSettings.workspaceId, input.workspaceId),
      eq(formSubmitterSettings.formId, input.formId),
    ) as SQL,
    {
      inherit: input.settings == null,
      allowSubmitterDrafts: input.settings?.allowSubmitterDrafts ?? null,
      updatedBy: input.actorDisplayLabel,
      updatedAt: new Date(),
    },
    input.version,
    input.audit && {
      workspaceId: input.workspaceId,
      formId: input.formId,
      groupKey: SUBMITTER_SETTINGS_KEY,
      actorId: input.audit.actorId,
      actorDisplayLabel: input.actorDisplayLabel,
    },
  );
