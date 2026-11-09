import { db } from '../../../core/db/client';
import { NotFoundError, ValidationError } from '../../../core/errors';
import type { PostSubmissionActionPluginDefinition } from '../../../core/integrations/post-submission-action/PostSubmissionActionPluginDefinition';
import {
  findPostSubmissionAction,
  getPostSubmissionActions,
} from '../../../core/integrations/post-submission-action/PostSubmissionActionRegistry';
import { assertSaved } from '../../form-settings/saved';
import { findActionSettingRows, saveActionSetting } from '../repo';
import { formAction, isWorkspaceConfigurable, type ScopedAction } from '../resolve';
import {
  rowsFor,
  toFormActionSettings,
  toWorkspaceActionSettings,
  type ActionSettingRow,
  type ActionValues,
  type FormActionSettings,
  type WorkspaceActionSettings,
} from '../rules';
import type { SetFormActionBody, SetWorkspaceActionBody } from './schema';

/** Who is reading or saving, and where: a form, or the workspace's defaults when formId is null. */
export interface ActionScopeContext {
  workspaceId: string;
  formId: string | null;
  actorId: string;
  actorDisplayLabel: string | null;
}

type ActionSettings = FormActionSettings | WorkspaceActionSettings;

const NOT_FOUND = 'Post-submission action not found';

/** The action where it can be set at this scope, with the scopes its settings come from; else null. */
const configurable = async (
  plugin: PostSubmissionActionPluginDefinition,
  ctx: ActionScopeContext,
): Promise<ScopedAction | null> => {
  if (ctx.formId !== null) return formAction(plugin, ctx.workspaceId, ctx.formId);
  return (await isWorkspaceConfigurable(plugin, ctx.workspaceId))
    ? { plugin, scopes: plugin.scopes }
    : null;
};

const requireAction = async (code: string, ctx: ActionScopeContext): Promise<ScopedAction> => {
  const plugin = findPostSubmissionAction(code);
  const action = plugin && (await configurable(plugin, ctx));
  if (!action) throw new NotFoundError(NOT_FOUND);
  return action;
};

/** The options the plugin's schema accepts. An action that is off may keep none. */
export const checkedOptions = (
  plugin: PostSubmissionActionPluginDefinition,
  values: ActionValues,
): Record<string, unknown> => {
  if (!values.enabled && Object.keys(values.options).length === 0) return {};
  const parsed = plugin.optionsSchema.safeParse(values.options);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'options'}: ${issue.message}`)
      .join('; ');
    throw new ValidationError(`Invalid options for ${plugin.code}: ${detail}`);
  }
  return parsed.data;
};

const viewOf = (
  action: ScopedAction,
  rows: readonly ActionSettingRow[],
  ctx: ActionScopeContext,
): ActionSettings => {
  const { workspaceRow, formRow } = rowsFor(rows, action.plugin.code);
  return ctx.formId === null
    ? toWorkspaceActionSettings(workspaceRow)
    : toFormActionSettings(workspaceRow, formRow, action.scopes);
};

const read = async (action: ScopedAction, ctx: ActionScopeContext): Promise<ActionSettings> =>
  viewOf(action, await findActionSettingRows(db, ctx.workspaceId, ctx.formId), ctx);

/**
 * The actions configurable at this scope, each with its settings. A form's list also says whether
 * the workspace can set each action, which decides whether the form can inherit it.
 */
export const listActions = async (ctx: ActionScopeContext) => {
  const actions = await Promise.all(
    getPostSubmissionActions().map((plugin) => configurable(plugin, ctx)),
  );
  const rows = await findActionSettingRows(db, ctx.workspaceId, ctx.formId);
  return {
    actions: actions
      .filter((action) => action !== null)
      .map((action) => ({
        code: action.plugin.code,
        name: action.plugin.metadata.name,
        description: action.plugin.metadata.description,
        scopes: action.plugin.scopes,
        ...(ctx.formId === null
          ? {}
          : { workspaceConfigurable: action.scopes.includes('workspace') }),
        settings: viewOf(action, rows, ctx),
      })),
  };
};

export const getAction = async (code: string, ctx: ActionScopeContext) =>
  read(await requireAction(code, ctx), ctx);

const save = async (
  action: ScopedAction,
  ctx: ActionScopeContext,
  values: ActionValues | null,
  version: number,
) => {
  const status = await saveActionSetting({
    workspaceId: ctx.workspaceId,
    formId: ctx.formId,
    code: action.plugin.code,
    values: values && { enabled: values.enabled, options: checkedOptions(action.plugin, values) },
    version,
    actorDisplayLabel: ctx.actorDisplayLabel,
    audit: { actorId: ctx.actorId },
  });
  assertSaved(status, NOT_FOUND);
  return read(action, ctx);
};

/** A form's own values; null when it inherits. An action without a form scope takes none. */
export const formOwnValues = (
  plugin: PostSubmissionActionPluginDefinition,
  body: SetFormActionBody,
): ActionValues | null => {
  if (!('values' in body)) return null;
  if (!plugin.scopes.includes('form')) {
    throw new ValidationError(`${plugin.code} is set for the workspace only`);
  }
  return body.values;
};

/** A form inherits the workspace's settings for the action, or keeps its own. */
export const setFormAction = async (
  code: string,
  ctx: ActionScopeContext,
  body: SetFormActionBody,
) => {
  const action = await requireAction(code, ctx);
  return save(action, ctx, formOwnValues(action.plugin, body), body.version);
};

/** The workspace's default for the action, which its forms inherit unless they set their own. */
export const setWorkspaceAction = async (
  code: string,
  ctx: ActionScopeContext,
  body: SetWorkspaceActionBody,
) => save(await requireAction(code, ctx), ctx, body.values, body.version);
