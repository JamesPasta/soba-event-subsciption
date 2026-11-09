import type { InheritableSettings, PostSubmissionActionValues, WorkspaceSettings } from '@soba/lib';
import type {
  PostSubmissionActionScope,
  PostSubmissionActionSource,
} from '../../core/integrations/post-submission-action/PostSubmissionActionPluginDefinition';

/** An action's settings at one scope. */
export type ActionValues = PostSubmissionActionValues;

/** A saved settings row: a workspace's default when `formId` is null, else a form's own. */
export interface ActionSettingRow extends ActionValues {
  id: string;
  formId: string | null;
  actionCode: string;
  inherit: boolean;
  version: number;
}

export const ACTION_OFF: ActionValues = { enabled: false, options: {} };

const valuesOf = (row: ActionSettingRow): ActionValues => ({
  enabled: row.enabled,
  options: row.options,
});

const sourceOf = (
  row: ActionSettingRow,
  scope: PostSubmissionActionScope,
): PostSubmissionActionSource => ({ scope, settingId: row.id, version: row.version });

/** What applies to a form for one action, and the row it came from; null source means off by default. */
export interface EffectiveAction {
  values: ActionValues;
  source: PostSubmissionActionSource | null;
}

/**
 * A form's own row applies unless it inherits or the action has no form scope. Otherwise the form
 * follows the workspace's row when the action allows a workspace default; failing both, it is off.
 */
export const effectiveAction = (
  workspaceRow: ActionSettingRow | undefined,
  formRow: ActionSettingRow | undefined,
  scopes: readonly PostSubmissionActionScope[],
): EffectiveAction => {
  if (formRow && !formRow.inherit && scopes.includes('form')) {
    return { values: valuesOf(formRow), source: sourceOf(formRow, 'form') };
  }
  if (workspaceRow && scopes.includes('workspace')) {
    return { values: valuesOf(workspaceRow), source: sourceOf(workspaceRow, 'workspace') };
  }
  return { values: ACTION_OFF, source: null };
};

/**
 * Where an action is set for a form. Its workspace scope counts only when the workspace can set the
 * action itself, so a form granted the feature on its own never follows a workspace row that nobody
 * can see or change.
 */
export const formActionScopes = (
  scopes: readonly PostSubmissionActionScope[],
  workspaceConfigurable: boolean,
): PostSubmissionActionScope[] =>
  scopes.filter((scope) => scope === 'form' || workspaceConfigurable);

/** A form's view of one action, as the settings API returns it; version 0 until its first save. */
export type FormActionSettings = InheritableSettings<ActionValues>;

export const toFormActionSettings = (
  workspaceRow: ActionSettingRow | undefined,
  formRow: ActionSettingRow | undefined,
  scopes: readonly PostSubmissionActionScope[],
): FormActionSettings => {
  const inherit = !scopes.includes('form') || (formRow?.inherit ?? true);
  return {
    inherit,
    own: formRow && !inherit ? valuesOf(formRow) : null,
    workspace: workspaceRow && scopes.includes('workspace') ? valuesOf(workspaceRow) : ACTION_OFF,
    effective: effectiveAction(workspaceRow, formRow, scopes).values,
    version: formRow?.version ?? 0,
  };
};

/** A workspace's view of one action. */
export type WorkspaceActionSettings = WorkspaceSettings<ActionValues>;

export const toWorkspaceActionSettings = (
  workspaceRow: ActionSettingRow | undefined,
): WorkspaceActionSettings => ({
  values: workspaceRow ? valuesOf(workspaceRow) : ACTION_OFF,
  version: workspaceRow?.version ?? 0,
});

/** The rows for one action: the workspace's default and the form's own. */
export const rowsFor = (
  rows: readonly ActionSettingRow[],
  code: string,
): { workspaceRow?: ActionSettingRow; formRow?: ActionSettingRow } => ({
  workspaceRow: rows.find((row) => row.actionCode === code && row.formId === null),
  formRow: rows.find((row) => row.actionCode === code && row.formId !== null),
});
