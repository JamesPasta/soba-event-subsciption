import type {
  FormSubmitterSettings,
  SetFormSubmitterSettingsBody,
  WorkspaceSubmitterSettings,
} from '@soba/lib';
import { NotFoundError } from '../../../core/errors';
import { toInheritableSettings } from '../inheritable';
import { assertSaved } from '../saved';
import type { FormSettingsContext, FormSettingsService } from '../routes';
import {
  findSubmitterSettings,
  findWorkspaceSubmitterSettings,
  updateSubmitterSettings,
  updateWorkspaceSubmitterSettings,
} from './repo';

const FORM_NOT_FOUND = 'Form submitter settings not found';
const WORKSPACE_NOT_FOUND = 'Workspace submitter settings not found';

const readForm = async (ctx: FormSettingsContext, formId: string) => {
  const row = await findSubmitterSettings(ctx.workspaceId, formId);
  if (!row) throw new NotFoundError(FORM_NOT_FOUND);
  return toInheritableSettings(row, row.workspace);
};

/** A form's submitter settings: inherited from its workspace, or its own. */
export const formSubmitterSettingsService: FormSettingsService<
  FormSubmitterSettings,
  SetFormSubmitterSettingsBody
> = {
  get: readForm,

  async set(ctx, formId, body) {
    const status = await updateSubmitterSettings({
      workspaceId: ctx.workspaceId,
      formId,
      settings: body.inherit === false ? body.values : null,
      version: body.version,
      actorDisplayLabel: ctx.actorDisplayLabel,
      audit: { actorId: ctx.actorId ?? null },
    });
    assertSaved(status, FORM_NOT_FOUND);
    return readForm(ctx, formId);
  },
};

const readWorkspace = async (ctx: FormSettingsContext) => {
  const settings = await findWorkspaceSubmitterSettings(ctx.workspaceId);
  if (!settings) throw new NotFoundError(WORKSPACE_NOT_FOUND);
  return settings;
};

/** A workspace's submitter settings, which its forms inherit unless they set their own. */
export const workspaceSubmitterSettingsService: FormSettingsService<
  WorkspaceSubmitterSettings,
  WorkspaceSubmitterSettings
> = {
  get: readWorkspace,

  async set(ctx, _workspaceId, body) {
    const status = await updateWorkspaceSubmitterSettings({
      workspaceId: ctx.workspaceId,
      settings: body.values,
      version: body.version,
      actorDisplayLabel: ctx.actorDisplayLabel,
      audit: { actorId: ctx.actorId ?? null },
    });
    assertSaved(status, WORKSPACE_NOT_FOUND);
    return readWorkspace(ctx);
  },
};
