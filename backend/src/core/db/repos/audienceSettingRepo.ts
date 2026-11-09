import { and, count, eq, isNull, type SQL } from 'drizzle-orm';
import { AUDIENCE_SETTINGS_KEY, type Audience, type WorkspaceSettings } from '@soba/lib';
import { env } from '../../config/env';
import { db, type DbOrTx } from '../client';
import { formAudienceSettings, forms, workspaceAudienceSettings } from '../schema';
import { getIdentityProvider } from './identityProviderRepo';
import {
  recordSettingsAudit,
  saveSettingsRow,
  type SettingsSaveActor,
  type SettingsSaveStatus,
} from './settingsRow';

/** A form's audience row read with its workspace's. `own` is null while the form inherits. */
export interface FormAudienceRow {
  inherit: boolean;
  own: Audience | null;
  workspace: Audience;
  version: number;
}

// The table CHECKs keep mode within the known set and idps empty unless protected.
const toAudience = (mode: string, idps: string[]): Audience => ({ mode, idps }) as Audience;

/**
 * The audience a new workspace starts with: protected by the configured provider when it is an
 * active login provider, otherwise members only.
 */
const defaultWorkspaceAudience = async (executor: DbOrTx): Promise<Audience> => {
  const code = env.getDefaultSubmitterProvider();
  const provider = await getIdentityProvider(code, executor);
  return provider?.isActive && provider.isLoginProvider
    ? { mode: 'protected', idps: [code] }
    : { mode: 'members', idps: [] };
};

/** Creates a new workspace's audience row with the default audience. */
export const createWorkspaceAudienceSetting = async (
  input: { workspaceId: string; actorDisplayLabel: string | null },
  executor: DbOrTx,
): Promise<void> => {
  const audience = await defaultWorkspaceAudience(executor);
  await executor.insert(workspaceAudienceSettings).values({
    workspaceId: input.workspaceId,
    mode: audience.mode,
    idps: audience.idps,
    createdBy: input.actorDisplayLabel,
    updatedBy: input.actorDisplayLabel,
  });
};

/**
 * Creates a new form's audience row: its own audience when given, otherwise inheriting. With `audit`,
 * the audit records the row as created, with nothing before it.
 */
export const createFormAudienceSetting = async (
  input: {
    workspaceId: string;
    formId: string;
    audience?: Audience | null;
    actorDisplayLabel: string | null;
    audit?: SettingsSaveActor;
  },
  executor: DbOrTx,
): Promise<void> => {
  const values = {
    inherit: !input.audience,
    mode: input.audience?.mode ?? null,
    idps: input.audience?.idps ?? null,
  };
  const [created] = await executor
    .insert(formAudienceSettings)
    .values({
      workspaceId: input.workspaceId,
      formId: input.formId,
      ...values,
      createdBy: input.actorDisplayLabel,
      updatedBy: input.actorDisplayLabel,
    })
    .returning({ version: formAudienceSettings.version });
  if (input.audit) {
    await recordSettingsAudit(executor, {
      workspaceId: input.workspaceId,
      formId: input.formId,
      groupKey: AUDIENCE_SETTINGS_KEY,
      actorId: input.audit.actorId,
      actorDisplayLabel: input.actorDisplayLabel,
      version: created.version,
      before: {},
      after: values,
    });
  }
};

/** A workspace's audience and its version, or null when the workspace has no row. */
export const findWorkspaceAudience = async (
  workspaceId: string,
): Promise<WorkspaceSettings<Audience> | null> => {
  const rows = await db
    .select({
      mode: workspaceAudienceSettings.mode,
      idps: workspaceAudienceSettings.idps,
      version: workspaceAudienceSettings.version,
    })
    .from(workspaceAudienceSettings)
    .where(eq(workspaceAudienceSettings.workspaceId, workspaceId))
    .limit(1);
  const row = rows[0];
  return row ? { values: toAudience(row.mode, row.idps), version: row.version } : null;
};

/** Writes a workspace's audience if its row is still at `version`, audited when `audit` is given. */
export const updateWorkspaceAudience = (input: {
  workspaceId: string;
  audience: Audience;
  version?: number;
  actorDisplayLabel: string | null;
  audit?: SettingsSaveActor;
}): Promise<SettingsSaveStatus> =>
  saveSettingsRow(
    workspaceAudienceSettings,
    eq(workspaceAudienceSettings.workspaceId, input.workspaceId),
    {
      mode: input.audience.mode,
      idps: input.audience.idps,
      updatedBy: input.actorDisplayLabel,
      updatedAt: new Date(),
    },
    input.version,
    input.audit && {
      workspaceId: input.workspaceId,
      formId: null,
      groupKey: AUDIENCE_SETTINGS_KEY,
      actorId: input.audit.actorId,
      actorDisplayLabel: input.actorDisplayLabel,
    },
  );

/**
 * A form's audience row with its workspace's, or null when either row is missing. The submit-side
 * facts query in submitterFormRepo applies the same rule in SQL.
 */
export const findFormAudience = async (
  workspaceId: string,
  formId: string,
): Promise<FormAudienceRow | null> => {
  const rows = await db
    .select({
      inherit: formAudienceSettings.inherit,
      mode: formAudienceSettings.mode,
      idps: formAudienceSettings.idps,
      version: formAudienceSettings.version,
      workspaceMode: workspaceAudienceSettings.mode,
      workspaceIdps: workspaceAudienceSettings.idps,
    })
    .from(formAudienceSettings)
    .innerJoin(
      workspaceAudienceSettings,
      eq(workspaceAudienceSettings.workspaceId, formAudienceSettings.workspaceId),
    )
    .where(
      and(
        eq(formAudienceSettings.workspaceId, workspaceId),
        eq(formAudienceSettings.formId, formId),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    inherit: row.inherit,
    own: row.inherit || row.mode == null ? null : toAudience(row.mode, row.idps ?? []),
    workspace: toAudience(row.workspaceMode, row.workspaceIdps),
    version: row.version,
  };
};

/** How many live forms in the workspace use its audience rather than their own. */
export const countFormsInheritingAudience = async (workspaceId: string): Promise<number> => {
  const rows = await db
    .select({ count: count() })
    .from(formAudienceSettings)
    .innerJoin(forms, eq(forms.id, formAudienceSettings.formId))
    .where(
      and(
        eq(formAudienceSettings.workspaceId, workspaceId),
        eq(formAudienceSettings.inherit, true),
        isNull(forms.deletedAt),
      ),
    );
  return rows[0]?.count ?? 0;
};

/**
 * Writes a form's audience if its row is still at `version`, audited when `audit` is given. A null
 * audience inherits the workspace's and clears the form's own.
 */
export const updateFormAudience = (input: {
  workspaceId: string;
  formId: string;
  audience: Audience | null;
  version?: number;
  actorDisplayLabel: string | null;
  audit?: SettingsSaveActor;
}): Promise<SettingsSaveStatus> =>
  saveSettingsRow(
    formAudienceSettings,
    and(
      eq(formAudienceSettings.workspaceId, input.workspaceId),
      eq(formAudienceSettings.formId, input.formId),
    ) as SQL,
    {
      inherit: input.audience == null,
      mode: input.audience?.mode ?? null,
      idps: input.audience?.idps ?? null,
      updatedBy: input.actorDisplayLabel,
      updatedAt: new Date(),
    },
    input.version,
    input.audit && {
      workspaceId: input.workspaceId,
      formId: input.formId,
      groupKey: AUDIENCE_SETTINGS_KEY,
      actorId: input.audit.actorId,
      actorDisplayLabel: input.actorDisplayLabel,
    },
  );
