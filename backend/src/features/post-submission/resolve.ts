import type { DbOrTx } from '../../core/db/client';
import { Features } from '../../core/db/codes';
import type {
  PostSubmissionActionPluginDefinition,
  PostSubmissionActionScope,
  PostSubmissionActionSource,
} from '../../core/integrations/post-submission-action/PostSubmissionActionPluginDefinition';
import { getPostSubmissionActions } from '../../core/integrations/post-submission-action/PostSubmissionActionRegistry';
import {
  isFeatureAvailable,
  type FeatureScopeContext,
} from '../../core/services/featureAvailabilityService';
import { findActionSettingRows } from './repo';
import { effectiveAction, formActionScopes, rowsFor, type ActionSettingRow } from './rules';

/** An action where it is set: its plugin, and the scopes its settings come from there. */
export interface ScopedAction {
  plugin: PostSubmissionActionPluginDefinition;
  scopes: PostSubmissionActionScope[];
}

/** An action a submission runs, with the options saved when it was submitted. */
export interface SubmittedAction {
  code: string;
  options: Record<string, unknown>;
  source: PostSubmissionActionSource;
}

/** True when the action's own feature, if it has one, is available for the scope. */
export const actionFeatureAvailable = (
  plugin: PostSubmissionActionPluginDefinition,
  scope: FeatureScopeContext,
): Promise<boolean> =>
  plugin.featureCode ? isFeatureAvailable(plugin.featureCode, scope) : Promise.resolve(true);

/**
 * True when the workspace can set the action itself: the action has a workspace scope, and
 * post-submission and the action's feature are available to the workspace, not only to its forms.
 */
export const isWorkspaceConfigurable = async (
  plugin: PostSubmissionActionPluginDefinition,
  workspaceId: string,
): Promise<boolean> => {
  if (!plugin.scopes.includes('workspace')) return false;
  const [postSubmission, feature] = await Promise.all([
    isFeatureAvailable(Features.post_submission, { workspaceId }),
    actionFeatureAvailable(plugin, { workspaceId }),
  ]);
  return postSubmission && feature;
};

/** The action as the form has it; null when its feature is not available there or no scope is left. */
export const formAction = async (
  plugin: PostSubmissionActionPluginDefinition,
  workspaceId: string,
  formId: string,
): Promise<ScopedAction | null> => {
  const [available, workspaceConfigurable] = await Promise.all([
    actionFeatureAvailable(plugin, { workspaceId, formId }),
    isWorkspaceConfigurable(plugin, workspaceId),
  ]);
  const scopes = formActionScopes(plugin.scopes, workspaceConfigurable);
  return available && scopes.length > 0 ? { plugin, scopes } : null;
};

/**
 * The action plugins enabled here that the form can set, in the order they are enabled. Feature
 * checks read on the pool, so a submit runs this before its transaction takes a connection.
 */
export const availableActions = async (
  workspaceId: string,
  formId: string,
): Promise<ScopedAction[]> => {
  const actions = await Promise.all(
    getPostSubmissionActions().map((plugin) => formAction(plugin, workspaceId, formId)),
  );
  return actions.filter((action) => action !== null);
};

/** The actions to record with a submission: each available action whose settings turn it on. */
export const chooseSubmittedActions = (
  rows: readonly ActionSettingRow[],
  actions: readonly ScopedAction[],
): SubmittedAction[] =>
  actions.flatMap(({ plugin, scopes }) => {
    const { workspaceRow, formRow } = rowsFor(rows, plugin.code);
    const { values, source } = effectiveAction(workspaceRow, formRow, scopes);
    return values.enabled && source ? [{ code: plugin.code, options: values.options, source }] : [];
  });

/** The actions in effect for a form now, read on the submit's transaction. */
export const resolveSubmittedActions = async (
  executor: DbOrTx,
  workspaceId: string,
  formId: string,
  actions: readonly ScopedAction[],
): Promise<SubmittedAction[]> => {
  if (actions.length === 0) return [];
  const rows = await findActionSettingRows(executor, workspaceId, formId);
  return chooseSubmittedActions(rows, actions);
};
