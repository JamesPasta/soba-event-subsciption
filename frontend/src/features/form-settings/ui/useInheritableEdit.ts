'use client';

import { useState } from 'react';
import type { InheritableSettings, SetInheritableSettingsBody } from '@/src/types/formSettings';

/**
 * An edit of a shared group, layered over the loaded settings. While the form inherits, the values
 * shown are the workspace's and cannot change. Turning inherit off starts from the form's own values,
 * or the workspace's when it has none. Null means no edit, so a refresh shows through until the user
 * changes something.
 */
export function useInheritableEdit<T>(settings: InheritableSettings<T> | undefined) {
  const [edit, setEdit] = useState<{ inherit: boolean; values: T | null } | null>(null);

  const inherit = edit?.inherit ?? settings?.inherit ?? true;
  const ownValues = edit?.values ?? settings?.own ?? settings?.workspace ?? null;
  const values = inherit ? (settings?.workspace ?? null) : ownValues;

  return {
    inherit,
    /** The values shown: the workspace's while inheriting, otherwise the form's. */
    values,
    /** True once the user has changed something. */
    changed: edit !== null,
    setInherit: (next: boolean) => setEdit({ inherit: next, values: ownValues }),
    setValues: (next: T) => setEdit({ inherit: false, values: next }),
    /** The save body, from the version loaded, or null until the settings are loaded. */
    body: (): SetInheritableSettingsBody<T> | null => {
      if (!settings) return null;
      if (inherit) return { inherit: true, version: settings.version };
      return ownValues === null
        ? null
        : { inherit: false, values: ownValues, version: settings.version };
    },
    reset: () => setEdit(null),
  };
}
