import type {
  FormReviewSettings,
  SetFormReviewSettingsBody,
  WorkspaceReviewSettings,
} from '@soba/lib';
import { NotFoundError } from '../../../core/errors';
import { toInheritableSettings } from '../inheritable';
import { assertSaved } from '../saved';
import type { FormSettingsContext, FormSettingsService } from '../routes';
import {
  findReviewSettings,
  findWorkspaceReviewSettings,
  updateReviewSettings,
  updateWorkspaceReviewSettings,
} from './repo';

const FORM_NOT_FOUND = 'Form review settings not found';
const WORKSPACE_NOT_FOUND = 'Workspace review settings not found';

const readForm = async (ctx: FormSettingsContext, formId: string) => {
  const row = await findReviewSettings(ctx.workspaceId, formId);
  if (!row) throw new NotFoundError(FORM_NOT_FOUND);
  return toInheritableSettings(row, row.workspace);
};

/** A form's review settings: inherited from its workspace, or its own. */
export const formReviewSettingsService: FormSettingsService<
  FormReviewSettings,
  SetFormReviewSettingsBody
> = {
  get: readForm,

  async set(ctx, formId, body) {
    const status = await updateReviewSettings({
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
  const settings = await findWorkspaceReviewSettings(ctx.workspaceId);
  if (!settings) throw new NotFoundError(WORKSPACE_NOT_FOUND);
  return settings;
};

/** A workspace's review settings, which its forms inherit unless they set their own. */
export const workspaceReviewSettingsService: FormSettingsService<
  WorkspaceReviewSettings,
  WorkspaceReviewSettings
> = {
  get: readWorkspace,

  async set(ctx, _workspaceId, body) {
    const status = await updateWorkspaceReviewSettings({
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
