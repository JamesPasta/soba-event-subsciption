import type { DbOrTx } from '../../core/db/client';
import { mapInOrder } from '../../core/inOrder';
import { formSettingsModules } from './registry';
import type { FormSettingsRowInput, SettingsRowInput } from './types';

/**
 * Creates every group's row for a new form, in the transaction that creates the form. A group named
 * in `settings` starts with those values; the rest inherit. The groups run one at a time on the
 * transaction's one connection.
 */
export const createFormSettings = async (
  input: FormSettingsRowInput,
  executor: DbOrTx,
): Promise<void> => {
  await mapInOrder(formSettingsModules, (module) => module.createForForm(input, executor));
};

/**
 * Creates every shared group's row for a new workspace, in the transaction that creates it. The
 * groups run one at a time on the transaction's one connection.
 */
export const createWorkspaceSettings = async (
  input: SettingsRowInput,
  executor: DbOrTx,
): Promise<void> => {
  const shared = formSettingsModules.flatMap((module) =>
    module.workspace ? [module.workspace] : [],
  );
  await mapInOrder(shared, (workspace) => workspace.createForWorkspace(input, executor));
};
