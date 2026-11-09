import { ConflictError, NotFoundError } from '../../core/errors';
import type { SettingsSaveStatus } from '../../core/db/repos/settingsRow';

export const SETTINGS_CHANGED = 'These settings changed after they were read';

/** Throws for a save that did not land: 404 when the row is missing, 409 when it moved on. */
export const assertSaved = (status: SettingsSaveStatus, notFound: string): void => {
  if (status === 'notFound') throw new NotFoundError(notFound);
  if (status === 'conflict') throw new ConflictError(SETTINGS_CHANGED);
};
